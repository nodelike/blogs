# Blogs

Personal blog posts managed via CLI and synced to database.

## Setup on a New Machine

1. Clone this repo to `~/blogs`
2. Install the CLI:
   ```bash
   cd ~/blogs/.blog-cli
   npm install
   npm link
   ```
3. Configure database connection:
   ```bash
   blog setup
   ```

## Usage

```bash
# Create new blog
blog new "my-post-title"

# List local blogs
blog list

# Check sync status
blog status

# Push to database
blog push              # all blogs
blog push my-post      # specific blog

# Pull from database
blog pull              # all blogs
blog pull my-post      # specific blog

# Open blogs folder
blog open

# Edit a blog
blog edit my-post      # opens in $EDITOR
```

## Frontmatter

```yaml
---
title: "Post Title"
slug: "post-slug"
status: draft          # draft | published | archived
accessLevel: public    # public | reader | admin
publishedAt: "2024-03-20"
description: "SEO description"
image: "https://cloudinary.com/..."
tags:
  - tag1
  - tag2
---
```

## Images

Use Cloudinary URLs for images:

```markdown
![Alt text](https://res.cloudinary.com/dvapcjwvu/image/upload/v123/image.jpg)
```

With transformations:
```markdown
![Resized](https://res.cloudinary.com/dvapcjwvu/image/upload/w_800,q_auto/v123/image.jpg)
```
