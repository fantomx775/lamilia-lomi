import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createServer, type Server } from "node:http";
import { getSeedContentSnapshot } from "../../src/lib/local-content";
import { serializeRichTextDocument } from "../../src/lib/rich-text";
import type { ProductAsset } from "../../src/lib/types";
import frog from "./fixtures/issue-60/frog-prince-public.json";
import { acquireLocalContentStoreLock } from "./local-content-store-lock";
import { isLocalDemoAppTarget } from "./local-target";

test.setTimeout(240_000);

test("Issue 60 route skeleton retains streaming geometry", async ({page}, testInfo) => {
  test.skip(!(await isLocalDemoAppTarget(page,testInfo.project.use.baseURL)),"Requires the local delay hook.");
  await page.addInitScript(()=>localStorage.setItem("ll_cookie_consent",JSON.stringify({essential:true,analytics:false})));
  if(testInfo.project.name === "chromium") await page.setViewportSize({width:1440,height:900});
  await page.goto("/en/products",{waitUntil:"domcontentloaded"});
  await page.getByTestId("product-catalog-grid").getByRole("link").first().click();
  await expect(page.getByTestId("product-detail-loading")).toBeVisible();
  await page.addStyleTag({content:"nextjs-portal { display: none; }"});
  const directory=path.resolve(process.env.ISSUE_60_SCREENSHOT_DIR??"docs/verification/issue-60");
  fs.mkdirSync(directory,{recursive:true});
  await page.screenshot({path:path.join(directory,`loading-${testInfo.project.name}.png`),fullPage:true,animations:"disabled"});
  await expect(page.getByTestId("product-detail-loading")).toHaveCount(0);
  await expect(page.getByTestId("product-hero")).toBeVisible();
});

test("Issue 60 compact PDP, complete gallery and rich-text disclosure", async ({ page }, testInfo) => {
  test.skip(!(await isLocalDemoAppTarget(page, testInfo.project.use.baseURL)), "Disposable fixture requires the local demo backend.");
  const release = await acquireLocalContentStoreLock();
  const store = path.resolve("data/lamilialomi-content.local.json");
  const original = fs.existsSync(store) ? fs.readFileSync(store) : null;
  const directory = path.resolve(process.env.ISSUE_60_SCREENSHOT_DIR ?? "docs/verification/issue-60");
  const runId = process.env.ISSUE_60_RUN_ID ?? `issue-60-${Date.now()}`;
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: { url: string; status: number }[] = [];
  const failedRequests: { url: string; error: string | null; disposition?: string; reason?: string }[] = [];
  let videoServer: Server | undefined;
  const safeUrl = (url: string) => { const parsed = new URL(url); return parsed.origin + parsed.pathname; };
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => { if (response.status() >= 400) failedResponses.push({url:safeUrl(response.url()),status:response.status()}); });
  page.on("requestfailed", request => {
    const error = request.failure()?.errorText ?? null;
    failedRequests.push({url:safeUrl(request.url()),error,...(error === "net::ERR_ABORTED" ? {disposition:"unrelated",reason:request.resourceType()==="media"?"Browser cancelled a video range/buffer request; successful playback and HTTP responses are asserted separately.":"Navigation interrupted an in-flight request; HTTP responses and loaded fonts/images are checked separately."} : {})});
  });
  const shot = async (name: string, fullPage = false) => {
    fs.mkdirSync(directory, {recursive:true});
    await page.addStyleTag({content:"nextjs-portal { display: none; }"});
    await page.screenshot({path:path.join(directory,`${name}-${testInfo.project.name}.png`),fullPage,animations:"disabled"});
  };
  try {
    const snapshot = getSeedContentSnapshot();
    const product = structuredClone(snapshot.products[0]);
    product.id="60606060-6060-4060-8060-606060606060";
    product.slug = "issue-60-frog-prince";
    product.categoryIds=[snapshot.categories[1].id];
    product.productType="picture-book";
    const paragraphs=await page.evaluate(html=>[...new DOMParser().parseFromString(html,"text/html").querySelectorAll("p")].map(p=>p.textContent??""),frog.descriptionHtml);
    product.translations = [{locale:"en",title:frog.title,shortDescription:frog.shortDescription,longDescription:serializeRichTextDocument({type:"doc",content:paragraphs.map(text=>({type:"paragraph",content:[{type:"text",text}]}))})}];
    // Keep original public bytes locally: Windows upstream requests in Next's image
    // optimizer have a 7s deadline, shorter than these large source downloads.
    // This exercises the real local image optimizer without mocking its responses.
    const localMediaDirectory=path.resolve("public/uploads/issue-60-browser");
    fs.mkdirSync(localMediaDirectory,{recursive:true});
    const localSources=new Map<string,string>();
    for(const [index,source] of [frog.cover,...frog.images,...(frog.video?[frog.video]:[])].entries()) {
      const name=`source-${index}.${index===frog.images.length+1?"mp4":"png"}`;
      const destination=path.join(localMediaDirectory,name);
      if(!fs.existsSync(destination)) {
        const response=await fetch(source.path,{signal:AbortSignal.timeout(90_000)});
        if(!response.ok) throw new Error(`Public fixture download returned ${response.status}`);
        fs.writeFileSync(destination,Buffer.from(await response.arrayBuffer()));
      }
      localSources.set(source.path,`/uploads/issue-60-browser/${name}`);
    }
    // The demo locale middleware does not expose .mp4 static paths. Serve the
    // unchanged public video bytes on a temporary loopback origin with ranges.
    if(frog.video) {
      const file=path.join(localMediaDirectory,`source-${frog.images.length+1}.mp4`);
      const size=fs.statSync(file).size;
      videoServer=createServer((request,response)=>{
        const range=/^bytes=(\d+)-(\d*)$/.exec(request.headers.range??"");
        const start=range?Number(range[1]):0;
        const end=range&&range[2]?Math.min(Number(range[2]),size-1):size-1;
        if(start>end||start>=size) {response.writeHead(416,{"Content-Range":`bytes */${size}`});response.end();return;}
        response.writeHead(range?206:200,{"Content-Type":"video/mp4","Content-Length":end-start+1,"Accept-Ranges":"bytes",...(range?{"Content-Range":`bytes ${start}-${end}/${size}`}:{})});
        fs.createReadStream(file,{start,end}).pipe(response);
      });
      await new Promise<void>(resolve=>videoServer!.listen(0,"127.0.0.1",resolve));
      const address=videoServer.address();
      if(!address||typeof address==="string") throw new Error("Video fixture server did not bind a loopback port");
      localSources.set(frog.video.path,`http://127.0.0.1:${address.port}/video.mp4`);
    }
    const asset = (id: string, kind: ProductAsset["kind"], source: {path:string;alt?:string;title?:string}, index: number): ProductAsset => ({id,productId:product.id,kind,bucket:"public-media",path:localSources.get(source.path)!,filename:source.alt??source.title??id,contentType:kind === "video" ? "video/mp4" : "image/png",sortOrder:index,isPublic:true,title:source.alt??source.title});
    product.assets = [asset("issue60-cover","cover",frog.cover,0),...frog.images.map((image,index)=>asset(`issue60-page-${index}`,"gallery",image,index))];
    product.coverAssetId = "issue60-cover";
    if (frog.video) { product.assets.push(asset("issue60-video","video",frog.video,0)); product.videoAssetId = "issue60-video"; }
    product.amazonLinks[0].url = frog.amazon;
    snapshot.products.push(product);
    fs.mkdirSync(path.dirname(store),{recursive:true});
    const save = () => fs.writeFileSync(store,JSON.stringify(snapshot));
    save();
    await page.addInitScript(()=>localStorage.setItem("ll_cookie_consent",JSON.stringify({essential:true,analytics:false})));
    if(testInfo.project.name === "chromium") await page.setViewportSize({width:1440,height:900});
    await page.goto(`/en/products/${product.slug}`,{waitUntil:"domcontentloaded"});
    await expect(page.getByRole("heading",{level:1,name:frog.title})).toBeVisible();
    const hero = page.getByTestId("product-hero");
    await expect.poll(()=>hero.locator("img").first().evaluate(img=>(img as HTMLImageElement).naturalWidth),{timeout:45_000}).toBeGreaterThan(0);
    const actions=page.getByTestId("product-primary-actions");
    await expect(actions.getByRole("link",{name:"View on Amazon"})).toHaveAttribute("href",frog.amazon);
    await expect(actions.getByRole("link",{name:"Premium materials"})).toHaveAttribute("href","#premium");
    if(testInfo.project.name === "chromium") {
      const bounds=await actions.boundingBox();
      expect(bounds!.y+bounds!.height).toBeLessThan(900);
    }
    const more=page.getByRole("button",{name:"Read more",exact:true});
    await expect(more).toHaveAttribute("aria-expanded","false");
    await page.evaluate(()=>document.fonts.ready);
    await shot("initial",true);
    await more.click();
    const less=page.getByRole("button",{name:"Show less",exact:true});
    await expect(less).toHaveAttribute("aria-expanded","true");
    const content=page.locator(`[id="${await less.getAttribute("aria-controls")}"]`);
    await expect(content).not.toHaveAttribute("inert");
    await expect.poll(()=>content.evaluate(el=>Math.abs(el.clientHeight-el.scrollHeight))).toBeLessThan(2);
    await shot("expanded",true);
    await less.click();
    await expect(content).toHaveAttribute("inert");
    await expect.poll(()=>content.evaluate(el=>el.clientHeight)).toBeLessThanOrEqual(168);
    const inside=page.locator('section[aria-labelledby="inside-book-title"]');
    await inside.scrollIntoViewIfNeeded();
    await expect(inside.getByRole("button",{name:/Open image/})).toHaveCount(4);
    await expect(inside.getByText("+1 more",{exact:true})).toBeVisible();
    await expect.poll(()=>inside.locator("img").evaluateAll(images=>images.every(image=>(image as HTMLImageElement).naturalWidth>0)),{timeout:45_000}).toBe(true);
    await shot("gallery");
    const opener=inside.getByRole("button",{name:/Open image 4, View all 5 pages/});
    await opener.click();
    const dialog=page.getByRole("dialog",{name:"Image preview"});
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button",{name:"Close image preview"})).toBeFocused();
    await expect(dialog.getByText("4 of 5")).toBeVisible();
    await dialog.getByRole("button",{name:"Next image"}).click();
    await expect(dialog.getByText("5 of 5")).toBeVisible();
    await expect.poll(()=>dialog.locator("img").evaluate(img=>(img as HTMLImageElement).naturalWidth),{timeout:45_000}).toBeGreaterThan(0);
    await shot("lightbox");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByText("1 of 5")).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.getByText("5 of 5")).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
    if(testInfo.project.name === "mobile") {
      await dialog.getByTestId("product-gallery-preview-frame").evaluate(el=>{
        el.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,pointerType:"touch",clientX:240}));
        el.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,pointerType:"touch",clientX:60}));
      });
      await expect(dialog.getByText("1 of 5")).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(opener).toBeFocused();
    const video=inside.locator("video");
    await expect(video).toHaveAttribute("controls","");
    await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).readyState),{timeout:45_000}).toBeGreaterThan(0);
    await video.evaluate(el=>(el as HTMLVideoElement).play());
    await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).currentTime),{timeout:15_000}).toBeGreaterThan(0);
    await video.evaluate(el=>(el as HTMLVideoElement).pause());
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await actions.getByRole("link",{name:"Premium materials"}).click();
    await expect(page.getByTestId("product-unlock-section")).toBeVisible();
    await expect(page.getByTestId("product-unlock-section").getByRole("button",{name:"Log in",exact:true})).toBeVisible();
    // Rich HTML and short/empty copy exercise the same real route without published data changes.
    product.translations[0].longDescription=serializeRichTextDocument({type:"doc",content:[
      {type:"heading",attrs:{level:2},content:[{type:"text",text:"Explore the story"}]},
      {type:"paragraph",content:[{type:"text",text:"Read "},{type:"text",text:"the story",marks:[{type:"link",attrs:{href:"https://example.com/story"}}]},{type:"text",text:" together."}]},
      {type:"bulletList",content:["Kindness","Promises"].map(text=>({type:"listItem",content:[{type:"paragraph",content:[{type:"text",text}]}]}))},
      ...Array.from({length:12},()=>({type:"paragraph",content:[{type:"text",text:"A long story about kindness and friendship."}]})),
    ]});
    product.assets=product.assets.filter(a=>a.kind!=="video");
    save();
    await page.goto(`/en/products/${product.slug}`,{waitUntil:"domcontentloaded"});
    await page.getByRole("button",{name:"Read more",exact:true}).click();
    await expect(page.getByRole("link",{name:"the story",exact:true})).toBeVisible();
    await expect(page.getByRole("heading",{name:"Explore the story"})).toBeVisible();
    await expect(hero.locator("ul li")).toHaveCount(2);
    await page.emulateMedia({reducedMotion:"reduce"});
    await page.getByRole("button",{name:"Show less",exact:true}).click();
    await expect(page.getByRole("link",{name:"the story",exact:true})).toHaveCount(0);
    const reducedClip=page.locator(`[id="${await page.getByRole("button",{name:"Read more",exact:true}).getAttribute("aria-controls")}"]`);
    expect(await reducedClip.evaluate(el=>getComputedStyle(el).transitionDuration)).toBe("0s");
    for(const count of [0,1,4]) {
      product.translations[0].longDescription=count===0 ? "" : "A short description.";
      product.assets=product.assets.filter(a=>a.kind!=="gallery");
      product.assets.push(...frog.images.slice(0,count).map((image,index)=>asset(`issue60-edge-${index}`,"gallery",image,index)));
      save();
      await page.reload({waitUntil:"domcontentloaded"});
      await expect(page.getByRole("heading",{level:1})).toBeVisible();
      await expect(page.getByRole("button",{name:"Read more",exact:true})).toHaveCount(0);
      await expect(inside.getByRole("button",{name:/Open image/})).toHaveCount(count);
      await expect(inside.getByText(/\+\d+ more/)).toHaveCount(0);
    }
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedResponses).toEqual([]);
    expect(failedRequests.filter(item=>item.disposition!=="unrelated")).toEqual([]);
  } finally {
    videoServer?.closeAllConnections();
    if(videoServer) await new Promise<void>((resolve,reject)=>videoServer!.close(error=>error?reject(error):resolve()));
    fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(path.join(directory,`diagnostics-${testInfo.project.name}.json`),JSON.stringify({runId,consoleErrors,pageErrors,failedResponses,failedRequests},null,2));
    if(original) fs.writeFileSync(store,original); else if(fs.existsSync(store)) fs.unlinkSync(store);
    release();
  }
});
