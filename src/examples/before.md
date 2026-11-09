# Markdown feature showcase

This is the **draft** release handbook. Compare prose, lists, and tables as a formatted document, then switch to **Source** to see the Markdown.

## Project status

| Project | Owner | Status |
| :--- | :---: | ---: |
| Website | Maya | In review |
| API docs | Alex | Draft |
| Search | Sam | Planned |
| Legacy import | Jo | Retiring |

## Release checklist

- [x] Outline the release
- [ ] Review the documentation
  - Check the **old examples**
  - Confirm the links
- [ ] Publish the announcement

## Lists

### Bulleted and nested lists

- Keep the useful details
  - A nested item with *emphasis*
  - Another nested item
- Keep the final item in view

### Numbered steps

1. Install dependencies.
2. Start the preview.
3. Review the document.

## Text formatting

Use **bold** for important details, *italics* for emphasis, and ***both together*** when needed. Keep `inline code` readable. ~~Deprecated instructions~~ remain visibly struck through.

The release is available to a **small group**. The default timeout is `30` seconds.

## Tables with structure changes

| Setting | Default | Description |
| :--- | ---: | :--- |
| `timeout` | 30 | Seconds before retrying |
| `retries` | 2 | Maximum attempts |

## Links and images

Read the [project guide](https://example.com/guide). Bare links also work: https://example.com/status. An email link is <team@example.com>.

![The release starts with a draft and ends with publication.](/examples/workflow-before.svg "The original workflow")

## Blockquotes

> **Note:** Review the handbook before 5 pm.
>
> A quote can contain another paragraph.
>
> > Nested quotes preserve their structure too.

## Code blocks

### Fenced JavaScript

```js
function greet(name) {
  const message = `Hello, ${name}!`;
  console.log(message);
  return message;
}
```

### Indented code

    npm install
    npm run preview

## Heading hierarchy

### A third-level heading

A short subsection keeps its own spacing.

#### A fourth-level heading

More specific details belong here.

##### A fifth-level heading

Small supporting notes are still easy to recognize.

###### A sixth-level heading

The smallest heading keeps its semantic level.

## Expandable details

<details>
<summary>Open the example configuration</summary>

This content stays inside a native expandable section.

```json
{
  "version": "1.0",
  "timeout": 30,
  "enabled": false
}
```

</details>

## Line breaks and escaped characters

This sentence has a hard line break.\
This sentence begins on the next line.

A soft line break
continues the same paragraph.

Escaped markers stay literal: \*asterisks\*, \[brackets\], and \# a hash.

Unicode stays intact: café, שלום, and こんにちは.

---

Drop your own Markdown files over either side whenever you are ready.
