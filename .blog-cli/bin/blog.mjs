#!/usr/bin/env node

/**
 * Blog CLI - Global command-line tool for managing blogs
 * 
 * Usage:
 *   blog new <slug>           Create new blog from template
 *   blog edit <slug>          Open blog in $EDITOR
 *   blog list                 List all local blogs
 *   blog status               Compare local vs database
 *   blog push [slug]          Push blogs to database
 *   blog pull [slug]          Pull blogs from database
 *   blog open                 Open blogs folder in Finder/file manager
 *   blog config               Show/edit configuration
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { program } from 'commander';
import matter from 'gray-matter';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { execSync, spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(os.homedir(), '.config', 'blog');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const BLOGS_DIR = path.join(os.homedir(), 'blogs');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

const log = {
  info: (msg) => console.log(`${c.blue}info${c.reset}  ${msg}`),
  ok: (msg) => console.log(`${c.green}ok${c.reset}    ${msg}`),
  warn: (msg) => console.log(`${c.yellow}warn${c.reset}  ${msg}`),
  error: (msg) => console.log(`${c.red}error${c.reset} ${msg}`),
  dim: (msg) => console.log(`${c.dim}${msg}${c.reset}`),
  title: (msg) => console.log(`\n${c.bold}${c.cyan}${msg}${c.reset}\n`),
};

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
}

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function ensureConfig() {
  const config = loadConfig();
  if (!config || !config.databaseUrl) {
    log.error('Blog CLI not configured. Run: blog config --setup');
    process.exit(1);
  }
  return config;
}

// ─────────────────────────────────────────────────────────────
// Database Connection
// ─────────────────────────────────────────────────────────────

let prisma = null;

function getDb() {
  if (prisma) return prisma;
  
  const config = ensureConfig();
  
  const poolConfig = {
    connectionString: config.databaseUrl.replace(/[?&]sslmode=[^&]+/, ''),
    max: 2,
    idleTimeoutMillis: 5000,
  };
  
  if (config.caCert) {
    poolConfig.ssl = {
      rejectUnauthorized: true,
      ca: Buffer.from(config.caCert, 'base64').toString('utf-8'),
    };
  }
  
  const pool = new pg.Pool(poolConfig);
  const adapter = new PrismaPg(pool);
  prisma = new PrismaClient({ adapter });
  
  return prisma;
}

async function closeDb() {
  if (prisma) {
    await prisma.$disconnect();
  }
}

// ─────────────────────────────────────────────────────────────
// Blog File Operations
// ─────────────────────────────────────────────────────────────

function getBlogFiles() {
  if (!fs.existsSync(BLOGS_DIR)) {
    fs.mkdirSync(BLOGS_DIR, { recursive: true });
    return [];
  }
  
  return fs.readdirSync(BLOGS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.') && f !== 'README.md')
    .map(f => path.join(BLOGS_DIR, f));
}

function parseBlog(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const { data: frontmatter, content: body } = matter(content);
  
  const {
    title,
    slug,
    status = 'draft',
    accessLevel = 'public',
    publishedAt,
    description,
    image,
    tags = [],
    ...extraMetadata
  } = frontmatter;

  return {
    title,
    slug: slug || path.basename(filePath, '.md'),
    content: body.trim(),
    status,
    accessLevel,
    publishedAt: publishedAt ? new Date(publishedAt) : null,
    metadata: {
      description: description || '',
      image: image || '',
      tags: Array.isArray(tags) ? tags : [],
      ...extraMetadata,
    },
    filePath,
  };
}

function blogToMarkdown(node) {
  const { title, slug, content, status, accessLevel, publishedAt, metadata } = node;
  const { description, image, tags, ...extra } = metadata || {};
  
  const fm = {
    title,
    slug,
    status,
    accessLevel,
    ...(publishedAt && { publishedAt: publishedAt.toISOString().split('T')[0] }),
    ...(description && { description }),
    ...(image && { image }),
    ...(tags?.length > 0 && { tags }),
    ...extra,
  };

  const lines = [];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      value.forEach(v => lines.push(`  - ${v}`));
    } else if (typeof value === 'string' && (value.includes(':') || value.includes('"') || value.includes('\n'))) {
      lines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${key}: ${typeof value === 'string' ? `"${value}"` : value}`);
    }
  }

  return `---\n${lines.join('\n')}\n---\n\n${content || ''}`;
}

function generateSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────

async function cmdNew(slugArg) {
  const slug = generateSlug(slugArg);
  const filePath = path.join(BLOGS_DIR, `${slug}.md`);
  
  if (fs.existsSync(filePath)) {
    log.error(`File already exists: ${slug}.md`);
    return;
  }
  
  const title = slugArg.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const today = new Date().toISOString().split('T')[0];
  
  const content = `---
title: "${title}"
slug: "${slug}"
status: draft
accessLevel: public
publishedAt: "${today}"
description: ""
image: ""
tags: []
---

# ${title}

Start writing here...
`;

  fs.mkdirSync(BLOGS_DIR, { recursive: true });
  fs.writeFileSync(filePath, content);
  log.ok(`Created: ${filePath}`);
  
  // Open in editor if $EDITOR is set
  const editor = process.env.EDITOR;
  if (editor) {
    log.dim(`Opening in ${editor}...`);
    spawn(editor, [filePath], { stdio: 'inherit' });
  }
}

async function cmdEdit(slug) {
  // Strip .md extension if provided
  const cleanSlug = slug.replace(/\.md$/, '');
  const filePath = path.join(BLOGS_DIR, `${cleanSlug}.md`);
  
  if (!fs.existsSync(filePath)) {
    log.error(`Blog not found: ${cleanSlug}`);
    log.dim(`Run 'blog list' to see available blogs`);
    return;
  }
  
  const editor = process.env.EDITOR || 'code';
  spawn(editor, [filePath], { stdio: 'inherit' });
}

async function cmdRm(slug) {
  const cleanSlug = slug.replace(/\.md$/, '');
  const filePath = path.join(BLOGS_DIR, `${cleanSlug}.md`);
  
  // Delete local file if exists
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    log.ok(`Deleted local: ${cleanSlug}.md`);
  }
  
  // Delete from DB
  try {
    const db = getDb();
    const existing = await db.node.findUnique({ where: { slug: cleanSlug } });
    if (existing) {
      await db.node.delete({ where: { slug: cleanSlug } });
      log.ok(`Deleted from DB: ${cleanSlug}`);
    }
    await closeDb();
  } catch (err) {
    log.error(`DB: ${err.message}`);
  }
}

async function cmdList() {
  const files = getBlogFiles();
  
  if (files.length === 0) {
    log.warn('No blogs found');
    log.dim(`Create one with: blog new my-first-post`);
    return;
  }
  
  // Parse all blogs
  const blogs = files.map(f => parseBlog(f));
  
  // Sort by access level: public > reader > admin
  const accessOrder = { public: 0, reader: 1, admin: 2 };
  blogs.sort((a, b) => (accessOrder[a.accessLevel] ?? 3) - (accessOrder[b.accessLevel] ?? 3));
  
  log.title('Local Blogs');
  
  for (const blog of blogs) {
    const icon = { draft: '[ ]', published: '[x]', archived: '[-]' }[blog.status] || '[ ]';
    const accessColor = { admin: c.red, reader: c.yellow, public: '\x1b[38;5;208m' }[blog.accessLevel] || c.dim;
    const access = ` ${accessColor}[${blog.accessLevel}]${c.reset}`;
    
    console.log(`${icon} ${c.cyan}${blog.slug}${c.reset}${access}`);
    console.log(`    ${c.dim}${blog.title}${c.reset}`);
  }
  
  console.log(`\n${c.dim}Total: ${blogs.length} blogs${c.reset}`);
}

async function cmdStatus() {
  const db = getDb();
  
  const localFiles = getBlogFiles();
  const localSlugs = new Map();
  
  for (const file of localFiles) {
    const blog = parseBlog(file);
    localSlugs.set(blog.slug, blog);
  }
  
  const dbBlogs = await db.node.findMany({
    where: { type: 'blog' },
    select: { slug: true, title: true, status: true, accessLevel: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  
  const dbSlugs = new Map(dbBlogs.map(b => [b.slug, b]));
  
  log.title('Blog Status');
  
  // Local only
  const localOnly = [...localSlugs.keys()].filter(s => !dbSlugs.has(s));
  if (localOnly.length > 0) {
    console.log(`${c.green}Local only (push to create):${c.reset}`);
    localOnly.forEach(s => console.log(`  + ${s}`));
    console.log('');
  }
  
  // DB only
  const dbOnly = dbBlogs.filter(b => !localSlugs.has(b.slug));
  if (dbOnly.length > 0) {
    console.log(`${c.yellow}Database only (pull to fetch):${c.reset}`);
    dbOnly.forEach(b => {
      const access = b.accessLevel !== 'public' ? ` [${b.accessLevel}]` : '';
      console.log(`  - ${b.slug}${access}`);
    });
    console.log('');
  }
  
  // Synced
  const synced = [...localSlugs.keys()].filter(s => dbSlugs.has(s));
  if (synced.length > 0) {
    console.log(`${c.cyan}Synced:${c.reset}`);
    synced.forEach(s => console.log(`  = ${s}`));
    console.log('');
  }
  
  console.log(`${c.dim}Total: ${localSlugs.size} local, ${dbSlugs.size} in database${c.reset}`);
  
  await closeDb();
}

async function cmdPush(targetSlug, options) {
  const db = getDb();
  const { dryRun } = options;
  
  let files = getBlogFiles();
  
  if (targetSlug) {
    files = files.filter(f => {
      const blog = parseBlog(f);
      return blog.slug === targetSlug || path.basename(f, '.md') === targetSlug;
    });
    
    if (files.length === 0) {
      log.error(`Blog not found: ${targetSlug}`);
      await closeDb();
      return;
    }
  }
  
  if (files.length === 0) {
    log.warn('No blogs to push');
    await closeDb();
    return;
  }
  
  log.title('Pushing Blogs');
  
  if (dryRun) {
    log.warn('DRY RUN - no changes will be made\n');
  }
  
  const results = { created: 0, updated: 0, errors: 0 };
  
  for (const file of files) {
    const blog = parseBlog(file);
    
    if (!blog.title || !blog.slug) {
      log.error(`Missing title/slug: ${file}`);
      results.errors++;
      continue;
    }
    
    if (!/^[a-z0-9-]+$/.test(blog.slug)) {
      log.error(`Invalid slug: ${blog.slug}`);
      results.errors++;
      continue;
    }
    
    const existing = await db.node.findUnique({ where: { slug: blog.slug } });
    
    const data = {
      type: 'blog',
      slug: blog.slug,
      title: blog.title,
      content: blog.content,
      status: blog.status,
      accessLevel: blog.accessLevel,
      metadata: blog.metadata,
      publishedAt: blog.publishedAt || (blog.status === 'published' && !existing?.publishedAt ? new Date() : existing?.publishedAt),
    };
    
    if (dryRun) {
      log.info(`Would ${existing ? 'update' : 'create'}: ${blog.slug}`);
      results[existing ? 'updated' : 'created']++;
    } else {
      if (existing) {
        await db.node.update({ where: { slug: blog.slug }, data });
        log.ok(`Updated: ${blog.slug}`);
        results.updated++;
      } else {
        await db.node.create({ data });
        log.ok(`Created: ${blog.slug}`);
        results.created++;
      }
    }
  }
  
  console.log('');
  if (results.created > 0) log.ok(`Created: ${results.created}`);
  if (results.updated > 0) log.ok(`Updated: ${results.updated}`);
  if (results.errors > 0) log.error(`Errors: ${results.errors}`);
  
  await closeDb();
}

async function cmdPull(targetSlug, options) {
  const db = getDb();
  const { force } = options;
  
  const where = { type: 'blog' };
  if (targetSlug) {
    where.slug = targetSlug;
  }
  
  const blogs = await db.node.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  });
  
  if (blogs.length === 0) {
    if (targetSlug) {
      log.error(`Blog not found in database: ${targetSlug}`);
    } else {
      log.warn('No blogs in database');
    }
    await closeDb();
    return;
  }
  
  log.title('Pulling Blogs');
  
  fs.mkdirSync(BLOGS_DIR, { recursive: true });
  const results = { created: 0, updated: 0, skipped: 0 };
  
  for (const blog of blogs) {
    const filePath = path.join(BLOGS_DIR, `${blog.slug}.md`);
    const exists = fs.existsSync(filePath);
    
    if (exists && !force) {
      log.warn(`Skipped (exists): ${blog.slug} - use --force to overwrite`);
      results.skipped++;
      continue;
    }
    
    const markdown = blogToMarkdown(blog);
    fs.writeFileSync(filePath, markdown);
    log.ok(`${exists ? 'Updated' : 'Created'}: ${blog.slug}.md`);
    results[exists ? 'updated' : 'created']++;
  }
  
  console.log('');
  if (results.created > 0) log.ok(`Created: ${results.created}`);
  if (results.updated > 0) log.ok(`Updated: ${results.updated}`);
  if (results.skipped > 0) log.warn(`Skipped: ${results.skipped}`);
  
  await closeDb();
}

async function cmdOpen() {
  const platform = process.platform;
  
  fs.mkdirSync(BLOGS_DIR, { recursive: true });
  
  if (platform === 'darwin') {
    execSync(`open "${BLOGS_DIR}"`);
  } else if (platform === 'win32') {
    execSync(`explorer "${BLOGS_DIR}"`);
  } else {
    execSync(`xdg-open "${BLOGS_DIR}"`);
  }
  
  log.ok(`Opened: ${BLOGS_DIR}`);
}

async function cmdImg(filePath, options) {
  const config = loadConfig();
  
  if (!config?.cloudinaryUrl) {
    log.error('Cloudinary not configured. Run: blog setup');
    return;
  }
  
  // Resolve file path
  const resolvedPath = path.resolve(filePath);
  
  if (!fs.existsSync(resolvedPath)) {
    log.error(`File not found: ${resolvedPath}`);
    return;
  }
  
  // Check if it's an image
  const ext = path.extname(resolvedPath).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'];
  if (!imageExts.includes(ext)) {
    log.error(`Not an image file: ${ext}`);
    return;
  }
  
  log.info(`Uploading: ${path.basename(resolvedPath)}...`);
  
  try {
    // Dynamic import cloudinary
    const { v2: cloudinary } = await import('cloudinary');
    
    // Parse CLOUDINARY_URL
    const url = new URL(config.cloudinaryUrl.replace('cloudinary://', 'http://'));
    cloudinary.config({
      cloud_name: url.hostname,
      api_key: url.username,
      api_secret: url.password,
    });
    
    // Upload options
    const uploadOptions = {
      folder: config.cloudinaryFolder || 'blog',
      resource_type: 'image',
    };
    
    // Use custom name if provided
    if (options.name) {
      uploadOptions.public_id = options.name;
    }
    
    const result = await cloudinary.uploader.upload(resolvedPath, uploadOptions);
    
    // Build the URL (with optional width)
    let imageUrl = result.secure_url;
    if (options.width) {
      // Insert transformation
      imageUrl = imageUrl.replace('/upload/', `/upload/w_${options.width},q_auto/`);
    }
    
    // Copy to clipboard
    const platform = process.platform;
    try {
      if (platform === 'darwin') {
        execSync(`echo "${imageUrl}" | pbcopy`);
      } else if (platform === 'win32') {
        execSync(`echo ${imageUrl} | clip`);
      } else {
        execSync(`echo "${imageUrl}" | xclip -selection clipboard`);
      }
      log.ok(`Copied to clipboard!`);
    } catch {
      // Clipboard failed, just show URL
    }
    
    console.log('');
    console.log(`${c.cyan}${imageUrl}${c.reset}`);
    console.log('');
    
    // Show markdown snippet
    const altText = options.alt || path.basename(resolvedPath, ext);
    log.dim(`Markdown: ![${altText}](${imageUrl})`);
    
  } catch (err) {
    log.error(`Upload failed: ${err.message}`);
  }
}

async function cmdConfig(options) {
  if (options.setup) {
    // Interactive setup
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    const question = (q) => new Promise(resolve => rl.question(q, resolve));
    
    log.title('Blog CLI Setup');
    
    const config = loadConfig() || {};
    
    console.log('Enter your database connection details:\n');
    
    const dbUrl = await question(`DATABASE_URL [${config.databaseUrl ? '***' : 'none'}]: `);
    if (dbUrl) config.databaseUrl = dbUrl;
    
    const caCert = await question(`CA_CERT (base64) [${config.caCert ? '***' : 'none'}]: `);
    if (caCert) config.caCert = caCert;
    
    console.log('');
    const cloudinaryUrl = await question(`CLOUDINARY_URL [${config.cloudinaryUrl ? '***' : 'none'}]: `);
    if (cloudinaryUrl) config.cloudinaryUrl = cloudinaryUrl;
    
    const cloudinaryFolder = await question(`CLOUDINARY_FOLDER [${config.cloudinaryFolder || 'blog'}]: `);
    if (cloudinaryFolder) config.cloudinaryFolder = cloudinaryFolder;
    
    rl.close();
    
    if (!config.databaseUrl) {
      log.error('DATABASE_URL is required');
      return;
    }
    
    saveConfig(config);
    log.ok(`Config saved to ${CONFIG_FILE}`);
    
    // Test connection
    log.info('Testing database connection...');
    try {
      const db = getDb();
      const count = await db.node.count({ where: { type: 'blog' } });
      log.ok(`Connected! Found ${count} blogs in database`);
      await closeDb();
    } catch (err) {
      log.error(`Connection failed: ${err.message}`);
    }
    
    return;
  }
  
  if (options.show) {
    const config = loadConfig();
    if (!config) {
      log.warn('No config found. Run: blog config --setup');
      return;
    }
    
    log.title('Current Configuration');
    console.log(`Config file: ${CONFIG_FILE}`);
    console.log(`Blogs dir:   ${BLOGS_DIR}`);
    console.log(`Database:    ${config.databaseUrl ? '***' + config.databaseUrl.slice(-20) : 'not set'}`);
    console.log(`CA Cert:     ${config.caCert ? 'set' : 'not set'}`);
    return;
  }
  
  // Default: show help
  console.log('Usage:');
  console.log('  blog config --setup   Interactive configuration');
  console.log('  blog config --show    Show current configuration');
}

// ─────────────────────────────────────────────────────────────
// CLI Definition
// ─────────────────────────────────────────────────────────────

program
  .name('blog')
  .description('Global CLI for managing blog posts')
  .version('1.0.0');

program
  .command('new <slug>')
  .description('Create a new blog post')
  .action(cmdNew);

program
  .command('edit <slug>')
  .description('Open blog in $EDITOR')
  .action(cmdEdit);

program
  .command('rm <slug>')
  .description('Delete blog (local + database)')
  .action(cmdRm);

program
  .command('list')
  .alias('ls')
  .description('List all local blogs')
  .action(cmdList);

program
  .command('status')
  .alias('st')
  .description('Compare local vs database')
  .action(cmdStatus);

program
  .command('push [slug]')
  .description('Push blogs to database')
  .option('-n, --dry-run', 'Preview without making changes')
  .action(cmdPush);

program
  .command('pull [slug]')
  .description('Pull blogs from database')
  .option('-f, --force', 'Overwrite existing files')
  .action(cmdPull);

program
  .command('open')
  .description('Open blogs folder in file manager')
  .action(cmdOpen);

program
  .command('setup')
  .description('Configure database and Cloudinary')
  .action(() => cmdConfig({ setup: true }));

program
  .command('img <file>')
  .description('Upload image to Cloudinary, copy URL to clipboard')
  .option('-w, --width <px>', 'Resize width (e.g., 800)')
  .option('-n, --name <name>', 'Custom public ID/name')
  .option('-a, --alt <text>', 'Alt text for markdown snippet')
  .action(cmdImg);

program.parse();
