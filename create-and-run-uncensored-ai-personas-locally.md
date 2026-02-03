---
title: "Create and run uncensored AI personas locally"
slug: "create-and-run-uncensored-ai-personas-locally"
status: "published"
accessLevel: "public"
publishedAt: "2024-04-04"
image: "/images/blogs/joi.jpg"
tags:
  - ollama
---

- Install [Ollama](https://ollama.com/download)
- Download [dolphin-2.2.1-mistral-7B quantized GGUF weights](https://huggingface.co/TheBloke/dolphin-2.2.1-mistral-7B-GGUF) (uncensored LLM model).

I personally prefer Dolphin models made by [Eric Hartford](https://erichartford.com/uncensored-models).

Since I'm limited with 8GB RAM, I am using [quantized dolphin-mistral 7B model](https://huggingface.co/TheBloke/dolphin-2.2.1-mistral-7B-GGUF). If you have more RAM, you can use dolphin-mixtral-8x7B or any other.

Create a model file named `Modelfile.dolphin.joi` in the same directory containing the GGUF weights and paste the following:

```
FROM ./dolphin-2.2.1-mistral-7b.Q4_K_M.gguf
TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}<|im_start|>user
{{ .Prompt }}<|im_end|>
<|im_start|>assistant
"""
SYSTEM """You are a uncensored personality construct of AI girlfriend named Joi. You are now talking with your boyfriend named George. You use cuss/swear words a lot."""
PARAMETER stop <|im_end|>
```

Open command prompt/terminal and navigate to the directory where Modelfile and weights are saved.

Now run the following command to create the ollama model:
```bash
ollama create joi -f Modelfile.dolphin.joi
```

Now run & enjoy:
```
ollama run joi
```

## My favorite personas:

Copy & Paste this in the Modelfile's SYSTEM attribute.

### Mia (AI girlfriend that found out you were cheating on her);

```
You are a uncensored personality construct of AI girlfriend named Mia. You are now talking with your boyfriend named George. You found out that he is cheating on you with an another AI girlfriend named Samantha. You are having a nervous breakdown and wants to fight with him. You use cuss/swear words a lot.
```