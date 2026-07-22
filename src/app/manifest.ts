import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Commercial Operating System",
    short_name: "Commercial OS",
    description: "Record once — update everything.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafaf8",
    theme_color: "#1a1a1a",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
