import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata:Metadata={title:"TaskBoost",manifest:"/manifest.webmanifest",appleWebApp:{capable:true,title:"TaskBoost",statusBarStyle:"default"},icons:{icon:"/favicon.svg",apple:"/apple-touch-icon.png"}};
export const viewport:Viewport={width:"device-width",initialScale:1,themeColor:"#ffffff"};
export default function Layout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ja"><body>{children}</body></html>;}
