import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import CookieConsent from "@/components/CookieConsent";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pushable.ai — AI Employees for Modern Teams",
  description:
    "Deploy autonomous agents for support, sales, research, and ops — billed by credits, scaled instantly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        {/* Google Tag Manager */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-5J4KB4PF');`,
          }}
        />
        {/* End Google Tag Manager */}
      </head>
      <body>
         {/* Google Tag Manager (noscript)  */}
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-5J4KB4PF"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
        {/* End Google Tag Manager (noscript)  */}
        {children}
        <CookieConsent />
      </body>
    </html>
  );
}

