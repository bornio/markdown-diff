# Markdown feature showcase

This is the **ready-to-publish** release handbook. Compare prose, lists, tables, and code as a formatted document, then switch to **Source** to see the Markdown.

## Project status

| Project | Owner | Status |
| :--- | :---: | ---: |
| Website | Maya | Ready |
| API docs | Alex | In review |
| Mobile app | Jo | Draft |
| Search | Sam | Planned |

## Release checklist

- [x] Outline the release
- [x] Review the documentation
  - Check the **new examples**
  - Add a quick-start walkthrough
  - Confirm the links
- [ ] Publish the announcement

## Lists

### Bulleted and nested lists

- Keep the important details
  - A nested item with **strong emphasis**
  - A newly added nested item
  - Another nested item
- Keep the final item in view

### Numbered steps

1. Install dependencies.
2. Run the checks.
3. Start the preview.
4. Review the document.

## Text formatting

Use **bold** for important details, *italics* for emphasis, and ***both together*** when needed. Keep `inline code` readable. ~~Deprecated instructions~~ remain visibly struck through.

The release is available to **everyone**. The default timeout is `60` seconds.

## Tables with structure changes

| Setting | Default | Scope | Description |
| :--- | ---: | :---: | :--- |
| `timeout` | 60 | Global | Seconds before retrying |
| `retries` | 3 | Per request | Maximum attempts |
| `batch_size` | 100 | Per request | Items processed together |

## Links and images

Read the [updated project guide](https://example.com/guide/latest). Bare links also work: https://example.com/status. An email link is <team@example.com>.

![The release moves from a draft through review before publication.](/examples/workflow-after.svg "The revised workflow")

## Blockquotes

> **Note:** Review the handbook before 6 pm.
>
> A quote can contain another paragraph and **formatted text**.
>
> > Nested quotes preserve their structure too.

## Code blocks

### Fenced JavaScript

```js
function greet(name = 'Markdown') {
  const message = `Welcome, ${name}!`;
  console.info(message);
  return message;
}
```

### Indented code

    npm install
    npm run build
    npm run preview

## Heading hierarchy

### A third-level heading

A short subsection keeps its own spacing.

#### An updated fourth-level heading

More specific details and the latest changes belong here.

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
  "version": "1.1",
  "timeout": 60,
  "enabled": true
}
```

</details>

## Line breaks and escaped characters

This sentence has an explicit hard line break.\
This sentence begins on the next line.

A soft line break
continues the same paragraph.

Escaped markers stay literal: \*asterisks\*, \[brackets\], and \# a hash.

Unicode stays intact: café, שלום, and こんにちは.

---

Drop your own Markdown files over either side whenever you are ready.
