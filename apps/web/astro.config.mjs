import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Vite operates ONLY as Astro's build/dev engine (DEC-04). No separate
// Vite app, no extra plugins: the Tailwind plugin below is Astro's
// documented CSS pipeline, not an independent build.
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
