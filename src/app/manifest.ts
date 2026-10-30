import type { MetadataRoute } from "next";

// Lets artists add Gigsaw to their phone's home screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gigsaw",
    short_name: "Gigsaw",
    description: "Your bookings, itineraries and arrival check-ins.",
    start_url: "/app",
    display: "standalone",
    background_color: "#15181c",
    theme_color: "#15181c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
