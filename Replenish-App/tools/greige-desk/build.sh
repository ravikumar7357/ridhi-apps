{ cat head.html; cat core.js; echo; cat ui.js; printf '</script>\n'; } > greige-desk.html
{ printf '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0}[hidden]{display:none!important}</style></head><body>\n'; cat greige-desk.html; printf '</body></html>'; } > test.html
node -e 'const s=require("fs").readFileSync("greige-desk.html","utf8");new Function(s.slice(s.indexOf("<script>")+8,s.lastIndexOf("</script>")));console.log("ok",s.length)'
