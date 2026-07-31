import { redirect } from "next/navigation";

/**
 * Home page — server-side redirect to /app.
 *
 * The original landing page (with SiteHeader / Hero / Editorial / Features /
 * Dimensions / Workflow / TechStack / UseCases / Author / CTA / SiteFooter)
 * has been moved to /landing to keep the dev-server's Turbopack module graph
 * small. On a 4 GiB machine, compiling the landing bundle on every reload
 * was pushing `next-server` past 1.4 GiB RSS and OOMing the process. /app
 * is the page users actually need; landing is now opt-in.
 *
 * If you want to show the landing page (e.g. for a demo), navigate to
 * `/landing` directly.
 */
export default function Home() {
  redirect("/app");
}
