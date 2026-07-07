export type SitePageContent = Record<string, unknown>;

export type GrapesContent = {
  type: "grapesjs";
  version: string;
  project: Record<string, unknown>;
  html?: string;
  css?: string;
  meta?: Record<string, unknown>;
};

export function isGrapesContent(content: SitePageContent): content is GrapesContent {
  return content.type === "grapesjs" && typeof content.project === "object";
}

export function defaultDesignerContent(title = "Home"): GrapesContent {
  return {
    type: "grapesjs",
    version: "dp3-mvp",
    project: { assets: [], styles: [], pages: [] },
    html: [
      '<main class="vhb-page">',
      '<section class="hero">',
      `<h1>${title}</h1>`,
      "<p>Design this page with the VHB Web Designer.</p>",
      '<a class="button" href="#">Call to action</a>',
      "</section>",
      "</main>",
    ].join(""),
    css: [
      "body{margin:0;font-family:Inter,Arial,sans-serif;color:#292d34;}",
      ".vhb-page{min-height:100vh;background:#f7f8fa;padding:48px;}",
      ".hero{max-width:960px;margin:0 auto;border-radius:24px;background:#fff;padding:64px;box-shadow:0 20px 60px rgba(31,90,166,.12);}",
      ".hero h1{font-size:56px;line-height:1;margin:0 0 16px;}",
      ".hero p{font-size:18px;color:#6b7078;margin:0 0 24px;}",
      ".button{display:inline-block;border-radius:10px;background:#0b8ff3;color:#fff;text-decoration:none;padding:12px 18px;font-weight:700;}",
    ].join(""),
  };
}
