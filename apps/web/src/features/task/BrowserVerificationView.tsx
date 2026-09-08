import type { Locale } from "../../i18n.js";
import type { ArtifactPreview } from "../../models.js";

export function BrowserVerificationView({browser, locale}: {browser: NonNullable<ArtifactPreview["browser"]>; locale: Locale}) {
  const zh = locale === "zh-CN";
  const state = (value: string) => zh ? ({passed: "通过", failed: "失败", not_run: "未执行", captured: "已生成", not_requested: "未要求", output_limit: "超出输出上限", completed: "已完成"} as Record<string,string>)[value] ?? value : value.replaceAll("_", " ");
  const image = browser.screenshot.dataUrl;
  const safeImage = image && image.length <= 1_000_030 && /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/u.test(image);
  return <section className="browser-verification" aria-label={zh ? "浏览器验证报告" : "Browser verification report"}>
    <h4>{zh ? "浏览器验证报告" : "Browser verification report"}</h4>
    <dl>
      <div><dt>{zh ? "浏览器启动" : "Browser startup"}</dt><dd>{state(browser.startup)}</dd></div>
      <div><dt>{zh ? "页面加载" : "Page load"}</dt><dd>{state(browser.pageLoad)}</dd></div>
      <div><dt>{zh ? "截图" : "Screenshot"}</dt><dd>{state(browser.screenshot.state)}</dd></div>
      <div><dt>{zh ? "进程与临时配置清理" : "Process and temporary profile cleanup"}</dt><dd>{state(browser.cleanup)}</dd></div>
      <div><dt>{zh ? "视觉复核" : "Visual review"}</dt><dd>{zh ? "尚未进行" : "Not performed"}</dd></div>
    </dl>
    <ol>{browser.steps.map((step,index) => <li key={index}><code>{step.selector}</code> · {step.action} · {state(step.state)}</li>)}</ol>
    <p>{zh ? "诊断" : "Diagnostic"}: {browser.reason}</p>
    {safeImage && <img src={image} alt={zh ? "候选页面截图，尚未完成视觉复核" : "Candidate screenshot; visual review has not been performed"} />}
  </section>;
}
