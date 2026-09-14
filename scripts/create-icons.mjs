import sharp from "sharp";
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#315add"/><path d="M170 314V216a86 86 0 0 1 172 0v98l30 36H140z" fill="white"/><path d="M223 374a34 34 0 0 0 66 0" fill="white"/><circle cx="355" cy="154" r="38" fill="#90eece"/></svg>');
for (const [size,name] of [[192,"icon-192.png"],[512,"icon-512.png"],[180,"apple-touch-icon.png"]]) await sharp(svg).resize(size,size).png().toFile("public/"+name);
