# ABC Calculators

Commuter benefit calculators.

## Tools

- `mbta-fare-calculator/`
- `bluebikes-membership-calculator/`
- `regional-rail-calculator/`

## Local preview

Open a tool's `index.html` in a browser, or serve the repo root with a static file server (for example `python3 -m http.server`).

## Build

```
./build.sh
```

## Embedding via iframe

Each `dist/*-embed.html` page posts its own real content height to its parent window on load and on every size change (mode switches, route changes, opening the accordion, etc.), as `{ type: "abc-calc-resize", height }`. A fixed-height `<iframe>` will otherwise show dangling whitespace or clip content, since the tool's actual height varies by mode/route. Add this listener once, wherever the `<iframe>` itself lives, and give the iframe `id="abc-calc-embed"` (or edit the selector below):

```html
<iframe id="abc-calc-embed" src="https://.../dist/mbta-fare-embed.html" style="width:100%; border:0;" scrolling="no"></iframe>
<script>
window.addEventListener("message", function (e) {
  if (e.data && e.data.type === "abc-calc-resize") {
    document.getElementById("abc-calc-embed").style.height = e.data.height + "px";
  }
});
</script>
```
