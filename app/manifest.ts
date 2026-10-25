import type { MetadataRoute } from "next";
import { PRODUCT_FULL_NAME, PRODUCT_NAME } from "@/src/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: PRODUCT_FULL_NAME,
    short_name: PRODUCT_NAME,
    description: "Automate your student meal reservations on Webetu.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#478f77",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
