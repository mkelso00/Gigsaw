import type { MetadataRoute } from "next";

// Lets artists add Gigsaw to their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gigsaw",
    short_name: "Gigsaw",
    description: "Your gigs, itineraries and arrival check-ins.",
    start_url: "/app",
    display: "standalone",
    background_color: "#0d0d0c",
    theme_color: "#0d0d0c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
