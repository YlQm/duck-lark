# Getting Started
- Hit run
- Edit [App.tsx](#src/App.tsx) and watch it live update!

# Learn More

You can learn more in the [Base Extension Development Guide](https://lark-technologies.larksuite.com/docx/HvCbdSzXNowzMmxWgXsuB2Ngs7d) or [多维表格扩展脚本开发指南](https://feishu.feishu.cn/docx/U3wodO5eqome3uxFAC3cl0qanIe).

## Install packages

Install packages in Shell pane or search and add in Packages pane.

## Preview built dist with a public tunnel

After running `npm run build`, you can preview the `dist` folder locally and expose it via a temporary public URL:

```bash
npx serve dist -l 53555 &
cloudflared tunnel --url http://localhost:53555
```

This will print a public `trycloudflare.com` URL you can share for quick testing.

## Publish
Please npm run build first, submit it together with the dist directory, and then fill in the form:
[Share form](https://feishu.feishu.cn/share/base/form/shrcnGFgOOsFGew3SDZHPhzkM0e)



## 发布
请先npm run build，连同dist目录一起提交，然后再填写表单：
[共享表单](https://feishu.feishu.cn/share/base/form/shrcnGFgOOsFGew3SDZHPhzkM0e)