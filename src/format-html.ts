// Prettier is loaded lazily so PNG captures never pay its load cost.
export async function formatHtml(html: string): Promise<string> {
  const [prettier, htmlPlugin, postcssPlugin] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/html"),
    import("prettier/plugins/postcss"),
  ]);
  return prettier.format(html, { parser: "html", plugins: [htmlPlugin, postcssPlugin] });
}
