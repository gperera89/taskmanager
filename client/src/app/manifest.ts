import type { MetadataRoute } from "next";

// Lets the phone offer "Add to Home Screen." iOS Safari only allows Web Push to a site that's
// been added to the home screen this way — a plain Safari tab can't receive push at all.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cura",
    short_name: "Cura",
    start_url: "/",
    display: "standalone",
    background_color: "#efe9dc",
    theme_color: "#17399b",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
