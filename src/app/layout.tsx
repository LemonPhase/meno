import type { Metadata } from "next";
import { IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";
import AppShell from "@/components/shell/AppShell";
import AuthGate from "@/components/auth/AuthGate";

const newsreader = Newsreader({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["300", "400", "500", "600"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Meno",
  description:
    "A learning assistant that builds a personal knowledge graph as you go.",
};

// The reading theme (Paper / Night) is a Settings pick stored in
// localStorage; stamping it on <html> before first paint avoids a flash.
const themeScript = `try{var t=localStorage.getItem("meno-reading-theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-ui",t)}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexSans.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <AuthGate>
          <AppShell>{children}</AppShell>
        </AuthGate>
      </body>
    </html>
  );
}
