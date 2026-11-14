import type { CSSProperties } from "react";
import { createFileRoute } from "@tanstack/react-router";
import capturedCSS from "../styles/site.css?raw";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "HX Engineering Control Center" }] }),
  staticData: { importedDocument: { html: { "lang": "en" }, body: {  } } },
  component: Index,
});

function Index() {
  return (
    <>
      <style>{capturedCSS}</style>
      <ImportedAside />
      <main>
        <header className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white flex justify-between [border-bottom:1px_solid_var(--line)]">
          <div className="text-(--muted) text-[12px] [@media(max-width:760px)]:hidden">HX workspace <span className="text-[#34475b] ml-[14px]">/ Engineering operations</span></div>
          <div className="topactions items-center flex">
            <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#eff4e7] rounded-[4px] text-[#637b3b] text-[10px] font-bold tracking-[0.5px] py-[6px] px-[8px]">DEV / TEST ONLY</span>
            <button className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white text-(--ink) cursor-pointer" id="mode">Owner sign-in</button>
            <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#344558] rounded-[50%] text-[#dee8f0] inline-grid h-[31px] mr-[8px] place-items-center w-[31px]">AZ</span>
          </div>
        </header>
        <div className="content max-w-[1700px] [@media(min-width:1600px)]:m-auto">
          <div className="titleline flex gap-[20px] justify-between">
            <div>
              <div className="text-(--muted) text-[9px] tracking-[1.5px] mb-[9px]">ENGINEERING OPERATIONS</div>
              <h1 className="tracking-[-0.8px] mt-0 mr-0 mb-[10px] ml-0" id="pageTitle">Engineering dashboard</h1>
              <p className="subtitle text-(--muted) leading-[1.6] m-0 max-w-[850px]" id="pageSub">Work, reviews and release gates across HX.</p>
            </div>
            <button className="primary bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-(--blue) text-white cursor-pointer [@media(max-width:760px)]:whitespace-nowrap" id="add">＋ New work item</button>
          </div>
          <div className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent border border-solid border-[#dce5f3] rounded-none text-(--muted) flex text-[11px] gap-[12px] mt-[16px] mr-0 mb-[22px] ml-0 py-[10px] px-0 [border-bottom:1px_solid_var(--line)]! [border-image:none] [border-left:0px]! [border-right:0px]! [border-top:0px]!">
            <span className="hidden">ⓘ</span>
            <div><strong className="text-[#3d587e]">Snapshot · Nov 13, 2026.</strong> GitHub + Drive records. Runtime evidence is reported; hosts are not monitored. Refresh PRs on request.</div>
          </div>
          <div id="view">
            <div className="dash-refresh items-center flex text-[11px] gap-[10px] mt-[-5px] mr-0 mb-[16px] ml-0 [@media(max-width:760px)]:flex-wrap">
              <div className="flex [gap:8px] items-center">
                <button className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white text-(--ink) cursor-pointer" id="refreshPRs">Refresh PRs from GitHub</button>
                <span className="text-(--muted) text-[10px]">Read on request · session only</span>
              </div>
              <div id="refreshStatus" role="status" />
            </div>
            <div className="metrics grid mb-[20px]">
              <div className="metric rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]" style={{ "--accent": "#3976ef" } as CSSProperties}>
                <span className="text-[#7c8da4] float-right text-[10px] tracking-[1px]">01</span>
                <label className="text-[#54667e] font-medium">Tracked outcomes</label>
                <div className="num tracking-[-1.5px] mt-[12px] mr-0 mb-[8px] ml-0">6</div>
                <small className="text-(--muted) block text-[11px]">Across 3 programs</small>
              </div>
              <div className="metric rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]" style={{ "--accent": "#20a58c" } as CSSProperties}>
                <span className="text-[#7c8da4] float-right text-[10px] tracking-[1px]">02</span>
                <label className="text-[#54667e] font-medium">In progress</label>
                <div className="num tracking-[-1.5px] mt-[12px] mr-0 mb-[8px] ml-0">1</div>
                <small className="text-(--muted) block text-[11px]">1 complete · 4 waiting</small>
              </div>
              <div className="metric rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]" style={{ "--accent": "#efad53" } as CSSProperties}>
                <span className="text-[#7c8da4] float-right text-[10px] tracking-[1px]">03</span>
                <label className="text-[#54667e] font-medium">Open pull requests</label>
                <div className="num tracking-[-1.5px] mt-[12px] mr-0 mb-[8px] ml-0">6</div>
                <small className="text-(--muted) block text-[11px]">Of 8 tracked PRs</small>
              </div>
              <div className="metric rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]" style={{ "--accent": "#8b6bd9" } as CSSProperties}>
                <span className="text-[#7c8da4] float-right text-[10px] tracking-[1px]">04</span>
                <label className="text-[#54667e] font-medium">Evidence records</label>
                <div className="num tracking-[-1.5px] mt-[12px] mr-0 mb-[8px] ml-0">17</div>
                <small className="text-(--muted) block text-[11px]">Linked source and acceptance records</small>
              </div>
            </div>
            <div className="dashboard-grid grid gap-[18px] mb-[20px]">
              <ImportedSectionPortfolioStatus />
              <ImportedSectionPullRequests />
              <ImportedSectionEvidenceCoverage />
            </div>
            <section className="panel bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] mb-[20px] overflow-hidden [border:1px_solid_var(--line)]">
              <div className="panelhead items-center flex justify-between [border-bottom:1px_solid_var(--line)] [@media(max-width:760px)]:flex-wrap [@media(max-width:760px)]:gap-[10px]">
                <h2 className="tracking-[-0.2px] m-0">Last recorded qualification</h2>
                <span className="text-(--muted) text-[10px]">Stage 2 · Run 1 · HX-18</span>
              </div>
              <div className="qualification-metrics grid gap-[20px] py-[20px] px-[22px]">
                <div>
                  <b className="block tracking-[-0.8px] mb-[8px]">254 / 254</b>
                  <span className="text-(--muted) text-[11px]">Requests passed</span>
                </div>
                <div>
                  <b className="block tracking-[-0.8px] mb-[8px]">16 / 16</b>
                  <span className="text-(--muted) text-[11px]">System One calls succeeded</span>
                </div>
                <div>
                  <b className="block tracking-[-0.8px] mb-[8px]">186 <small className="text-[13px] font-normal">ms</small></b>
                  <span className="text-(--muted) text-[11px]">D3-path median latency</span>
                </div>
                <div>
                  <b className="block tracking-[-0.8px] mb-[8px]">≤ 3 / 67</b>
                  <span className="text-(--muted) text-[11px]">Classifications reached HX-2</span>
                </div>
              </div>
              <div className="text-(--muted) text-[10px] py-[12px] px-[22px] [border-top:1px_solid_var(--line)]"><a className="text-(--blue) cursor-pointer no-underline" href="https://github.com/HX-Infratstructure/HX-Semantic-Router/issues/10#issuecomment-6846416722" rel="noopener noreferrer" target="_blank">Reported results ↗</a> · Sequential run. Most classifier results were cached. Concurrent Run 2 acceptance remains separate.</div>
            </section>
            <div className="lane-strip grid gap-[15px] mb-[20px]">
              <section className="lane-card items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[9px] flex gap-[14px] [border:1px_solid_var(--line)]">
                <div className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#edf2ff] rounded-[8px] text-[#3d63bc] grid text-[11px] font-bold h-[36px] place-items-center w-[36px]">CC1</div>
                <div>
                  <h3 className="text-[12px] mt-0 mr-0 mb-[4px] ml-0">Lane A · 2 tracked assignments</h3>
                  <p className="text-(--muted) text-[11px] leading-[1.6] m-0">1 complete · 1 not completed in saved record</p>
                </div>
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer ml-auto whitespace-nowrap">Open lane →</button>
              </section>
              <section className="lane-card items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[9px] flex gap-[14px] [border:1px_solid_var(--line)]">
                <div className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#edf2ff] rounded-[8px] text-[#3d63bc] grid text-[11px] font-bold h-[36px] place-items-center w-[36px]">CC2</div>
                <div>
                  <h3 className="text-[12px] mt-0 mr-0 mb-[4px] ml-0">Lane B · 2 tracked assignments</h3>
                  <p className="text-(--muted) text-[11px] leading-[1.6] m-0">0 complete · 2 not completed in saved record</p>
                </div>
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer ml-auto whitespace-nowrap">Open lane →</button>
              </section>
            </div>
            <div className="dashboard-bottom grid gap-[18px]">
              <ImportedSectionWorkRegister />
              <ImportedSectionReviewQueue />
            </div>
            <div className="dashboard-foot items-center flex flex-wrap gap-[8px] mt-[18px] mr-0 mb-[8px] ml-0">
              <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#f8fafc] border border-solid border-[#dce4ef] rounded-[4px] text-[#687b93] text-[10px] py-[5px] px-[8px]">DEV / TEST</span>
              <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#f8fafc] border border-solid border-[#dce4ef] rounded-[4px] text-[#687b93] text-[10px] py-[5px] px-[8px]">Native · bare metal</span>
              <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#f8fafc] border border-solid border-[#dce4ef] rounded-[4px] text-[#687b93] text-[10px] py-[5px] px-[8px]">Independent review</span>
              <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#f8fafc] border border-solid border-[#dce4ef] rounded-[4px] text-[#687b93] text-[10px] py-[5px] px-[8px]">Owner merge</span>
              <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#f8fafc] border border-solid border-[#dce4ef] rounded-[4px] text-[#687b93] text-[10px] py-[5px] px-[8px]">Separate deployment GO</span>
              <button className="panel-action bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Decisions &amp; constraints →</button>
            </div>
          </div>
          <div className="text-(--blue) text-[12px] mt-[8px] min-h-[20px]" id="message" role="status" />
          <footer className="text-[#8a95a2] flex text-[10px] justify-between leading-[1.6] mt-[25px]">
            <span>HX ENGINEERING / FOUR-AGENT GOVERNANCE · <a className="text-(--blue) cursor-pointer no-underline" href="/api/state" target="_blank">Read-only JSON for agents ↗</a></span>
            <span id="saved">Saved records · revision 0 · Read-only</span>
          </footer>
        </div>
      </main>
      <dialog className="border-0 rounded-[12px] [box-shadow:rgba(16,29,43,0.25)_0px_20px_100px] max-h-[90vh] p-0 w-[min(780px,95vw)] backdrop:bg-none backdrop:[background-position:0%_0%] backdrop:[background-size:auto_auto] backdrop:[background-repeat:repeat] backdrop:[background-origin:padding-box] backdrop:[background-clip:border-box] backdrop:[background-attachment:scroll] backdrop:bg-[#101d2b70]" id="modal">
        <form id="form">
          <div className="flex justify-between p-[24px] [border-bottom:1px_solid_var(--line)]">
            <h2 className="tracking-[-0.2px] m-0" id="modalTitle" />
            <button className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white text-(--ink) cursor-pointer" type="button" id="close" aria-label="Close">✕</button>
          </div>
          <div className="p-[24px]" id="fields" />
          <div className="flex gap-[10px] justify-between py-[18px] px-[24px] [border-top:1px_solid_var(--line)]">
            <span className="text-[#7f8e9d] text-[11px]" id="formHint" />
            <button className="primary bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-(--blue) text-white cursor-pointer" id="save">Save changes</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function ImportedAside() {
  return (
    <aside className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-(--nav) text-[#c4cdd6] flex flex-col top-0 right-auto bottom-0 left-0 overflow-y-auto">
      <div className="brand items-center text-white flex font-bold gap-[11px]">
        <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#3e76f4] rounded-[8px] text-white text-[21px] p-[8px]">HX</span>
        <div>ENGINEERING<small className="text-[#8b9bac] block tracking-[1.4px] mt-[4px]">CONTROL CENTER</small></div>
      </div>
      <div className="text-[#6f8192] text-[10px] tracking-[1.6px] mt-[25px] mr-[12px] mb-[13px] ml-[12px] [@media(max-width:760px)]:hidden">WORKSPACE</div>
      <nav className="[@media(max-width:760px)]:flex [@media(max-width:760px)]:mt-[14px] [@media(max-width:760px)]:overflow-auto" id="nav">
        <button className="active items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#1b3156] text-white cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">◫</b>Overview</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">♧</b>Assignments</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">↗</b>Pull requests</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">▦</b>Repositories</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">⊙</b>Issues</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">▤</b>Work register</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">◎</b>Review queue</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">◇</b>Acceptance gates</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">⑂</b>Decisions</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">⇄</b>Compare options</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">⌘</b>HX-12 traceability</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">▧</b>Evidence library</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">≡</b>Sources &amp; findings</button>
        <button className="items-center bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-[#a9b8c7] cursor-pointer flex gap-[12px] mb-[2px] text-left [@media(max-width:760px)]:whitespace-nowrap"><b className="text-[#8ea9d0] text-[16px] font-normal w-[18px]">↻</b>Change history</button>
      </nav>
      <div className="text-[12px] leading-[1.8] mt-auto pt-[22px] pr-[9px] pb-0 pl-[9px] [border-top:1px_solid_rgb(42,55,68)] [@media(max-width:760px)]:hidden"><span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#b3d77a] rounded-[50%] inline-block h-[7px] mr-[7px] w-[7px]" /> DEV / TEST environment<br /><span className="text-(--muted) text-[10px]">Bare metal · owner governed</span><div className="mt-[20px]"><span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#344558] rounded-[50%] text-[#dee8f0] inline-grid h-[31px] mr-[8px] place-items-center w-[31px]">AZ</span> Agent Zero <span className="text-(--muted) text-[10px]"> / Owner</span></div></div>
    </aside>
  );
}

function ImportedSectionPortfolioStatus() {
  return (
    <section className="panel bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]">
      <div className="panelhead items-center flex justify-between [border-bottom:1px_solid_var(--line)] [@media(max-width:760px)]:flex-wrap [@media(max-width:760px)]:gap-[10px]">
        <h2 className="tracking-[-0.2px] m-0">Portfolio status</h2>
        <button className="panel-action bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">View work →</button>
      </div>
      <div className="dash-body">
        <div className="text-(--muted) flex flex-wrap text-[10px] gap-[15px]">
          <span><i className="rounded-[2px] inline-block h-[7px] mr-[5px] w-[7px] [background:rgb(57,_118,_239)]" />In progress</span>
          <span><i className="rounded-[2px] inline-block h-[7px] mr-[5px] w-[7px] [background:rgb(239,_173,_83)]" />Waiting</span>
          <span><i className="rounded-[2px] inline-block h-[7px] mr-[5px] w-[7px] [background:rgb(32,_165,_140)]" />Complete</span>
        </div>
        <div className="my-[22px] mx-0">
          <div className="flex text-[12px] font-medium justify-between mb-[9px]">
            <span>IRP</span>
            <span>3</span>
          </div>
          <div className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#edf1f7] rounded-[4px] flex gap-[2px] h-[14px] overflow-hidden" role="img" aria-label="IRP: In progress, Complete, Waiting">
            <span className="h-full min-w-0 [width:33.3333%] [background:rgb(57,_118,_239)]" title="In progress: 1" />
            <span className="h-full min-w-0 [width:33.3333%] [background:rgb(239,_173,_83)]" title="Waiting: 1" />
            <span className="h-full min-w-0 [width:33.3333%] [background:rgb(32,_165,_140)]" title="Complete: 1" />
          </div>
        </div>
        <div className="my-[22px] mx-0">
          <div className="flex text-[12px] font-medium justify-between mb-[9px]">
            <span>Infrastructure</span>
            <span>2</span>
          </div>
          <div className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#edf1f7] rounded-[4px] flex gap-[2px] h-[14px] overflow-hidden" role="img" aria-label="Infrastructure: Waiting, Waiting">
            <span className="h-full min-w-0 [width:100%] [background:rgb(239,_173,_83)]" title="Waiting: 2" />
          </div>
        </div>
        <div className="my-[22px] mx-0">
          <div className="flex text-[12px] font-medium justify-between mb-[9px]">
            <span>Repo optimization</span>
            <span>1</span>
          </div>
          <div className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#edf1f7] rounded-[4px] flex gap-[2px] h-[14px] overflow-hidden" role="img" aria-label="Repository optimization: Waiting">
            <span className="h-full min-w-0 [width:100%] [background:rgb(239,_173,_83)]" title="Waiting: 1" />
          </div>
        </div>
        <p className="chart-note text-(--muted) text-[10px] leading-normal">Counts of tracked outcomes. Bar segments show status mix within each program, not percent completion.</p>
      </div>
    </section>
  );
}

function ImportedSectionPullRequests() {
  return (
    <section className="panel bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]">
      <div className="panelhead items-center flex justify-between [border-bottom:1px_solid_var(--line)] [@media(max-width:760px)]:flex-wrap [@media(max-width:760px)]:gap-[10px]">
        <h2 className="tracking-[-0.2px] m-0">Pull requests</h2>
        <button className="panel-action bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">View PRs →</button>
      </div>
      <div className="dash-body">
        <div className="donut-wrap mt-[2px] mr-auto mb-[18px] ml-auto relative">
          <svg className="h-full [transform:rotate(-90deg)] w-full" viewBox="0 0 160 160" role="img" aria-label="Open 4, Draft 2, Merged 2">
            <circle cx="80" cy="80" r="64" fill="none" stroke="#edf1f7" strokeWidth="13" />
            <circle cx="80" cy="80" r="64" fill="none" stroke="#3976ef" strokeWidth="13" strokeDasharray="50 50" strokeDashoffset="0" {...({ pathLength: "100" } as any)}>
              <title>Open: 4</title>
            </circle>
            <circle cx="80" cy="80" r="64" fill="none" stroke="#f0ad53" strokeWidth="13" strokeDasharray="25 75" strokeDashoffset="-50" {...({ pathLength: "100" } as any)}>
              <title>Draft: 2</title>
            </circle>
            <circle cx="80" cy="80" r="64" fill="none" stroke="#20a58c" strokeWidth="13" strokeDasharray="25 75" strokeDashoffset="-75" {...({ pathLength: "100" } as any)}>
              <title>Merged: 2</title>
            </circle>
          </svg>
          <div className="items-center flex flex-col inset-0 justify-center absolute">
            <b className="text-[34px] tracking-[-1px]">8</b>
            <span className="text-(--muted) text-[11px]">tracked PRs</span>
          </div>
        </div>
        <div className="prlegend flex justify-center">
          <div><i className="rounded-[50%] inline-block h-[7px] mr-[4px] w-[7px] [background:rgb(57,_118,_239)]" />Open<b className="block text-[17px] mt-[4px]">4</b></div>
          <div><i className="rounded-[50%] inline-block h-[7px] mr-[4px] w-[7px] [background:rgb(240,_173,_83)]" />Draft<b className="block text-[17px] mt-[4px]">2</b></div>
          <div><i className="rounded-[50%] inline-block h-[7px] mr-[4px] w-[7px] [background:rgb(32,_165,_140)]" />Merged<b className="block text-[17px] mt-[4px]">2</b></div>
        </div>
        <p className="chart-note text-(--muted) text-[10px] leading-normal">Saved status + this session’s GitHub reads.</p>
      </div>
    </section>
  );
}

function ImportedSectionEvidenceCoverage() {
  return (
    <section className="panel bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]">
      <div className="panelhead items-center flex justify-between [border-bottom:1px_solid_var(--line)] [@media(max-width:760px)]:flex-wrap [@media(max-width:760px)]:gap-[10px]">
        <h2 className="tracking-[-0.2px] m-0">Evidence coverage</h2>
        <button className="panel-action bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Sources →</button>
      </div>
      <div className="dash-body [@media(max-width:1200px)]:items-center [@media(max-width:1200px)]:flex-wrap [@media(max-width:1200px)]:gap-[25px]">
        <div>
          <div className="text-[32px] font-semibold tracking-[-1px] mb-[5px]">4<span className="text-(--muted) text-[13px] font-normal tracking-[0px]"> / 6 heads recorded</span></div>
          <div className="coveragebar bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#edf1f7] rounded-[10px] h-[7px] my-[17px] mx-0 overflow-hidden">
            <div className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#19a68e] rounded-[10px] h-full [width:66.6667%]" />
          </div>
        </div>
        <div className="text-site-import-muted-foreground flex text-[11px] justify-between py-[12px] px-0 [border-bottom:1px_solid_rgb(237,241,246)] [@media(max-width:1200px)]:min-w-[130px]">
          <span>Missing source SHA</span>
          <b className="text-(--ink)">2</b>
        </div>
        <div className="text-site-import-muted-foreground flex text-[11px] justify-between py-[12px] px-0 [border-bottom:1px_solid_rgb(237,241,246)] [@media(max-width:1200px)]:min-w-[130px]">
          <span>Work with evidence links</span>
          <b className="text-(--ink)">4 / 6</b>
        </div>
        <div className="text-site-import-muted-foreground flex text-[11px] justify-between py-[12px] px-0 [border-bottom:1px_solid_rgb(237,241,246)] [@media(max-width:1200px)]:min-w-[130px]">
          <span>Live host monitoring</span>
          <b className="text-(--ink)">Not connected</b>
        </div>
        <p className="chart-note text-(--muted) text-[10px] leading-normal">A recorded SHA or evidence link does not establish acceptance or a running release.</p>
      </div>
    </section>
  );
}

function ImportedSectionWorkRegister() {
  return (
    <section className="panel bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]">
      <div className="panelhead items-center flex justify-between [border-bottom:1px_solid_var(--line)] [@media(max-width:760px)]:flex-wrap [@media(max-width:760px)]:gap-[10px]">
        <h2 className="tracking-[-0.2px] m-0">Work register</h2>
        <span className="text-(--muted) text-[10px]">6 outcomes</span>
      </div>
      <div className="flex flex-wrap gap-[8px] py-[15px] px-[18px] [border-bottom:1px_solid_var(--line)]">
        <input className="flex-1" type="search" id="search" placeholder="Search work, hosts, commits…" aria-label="Search records" defaultValue="" />
        <div>
          <span role="combobox" aria-autocomplete="list" aria-expanded="false" aria-owns="bb-customSelect-qamKd-panel" aria-activedescendant="bb-customSelect-qamKd-selectedOption" tabIndex={0}>
            <span>Program</span>
          </span>
          <select className="cursor-pointer max-w-[180px]" aria-label="Filter by program" tabIndex={-1} defaultValue="">
            <option value="">Program</option>
            <option>IRP</option>
            <option>Infrastructure</option>
            <option>Repository optimization</option>
          </select>
          <div id="bb-customSelect-qamKd-panel" role="listbox">
            <div role="option" id="bb-customSelect-qamKd-selectedOption">Program</div>
            <div role="option">IRP</div>
            <div role="option">Infrastructure</div>
            <div role="option">Repository optimization</div>
          </div>
        </div>
        <div>
          <span role="combobox" aria-autocomplete="list" aria-expanded="false" aria-owns="bb-customSelect-2vvFk-panel" aria-activedescendant="bb-customSelect-2vvFk-selectedOption" tabIndex={0}>
            <span>Repository</span>
          </span>
          <select className="cursor-pointer max-w-[180px]" aria-label="Filter by repository" tabIndex={-1} defaultValue="">
            <option value="">Repository</option>
            <option>HX-Agent-Lab</option>
            <option>HX-Langchain-DeepAgent</option>
            <option>HX-Qdrant</option>
            <option>HX-Semantic-Router</option>
            <option>HX-n8n</option>
          </select>
          <div id="bb-customSelect-2vvFk-panel" role="listbox">
            <div role="option" id="bb-customSelect-2vvFk-selectedOption">Repository</div>
            <div role="option">HX-Agent-Lab</div>
            <div role="option">HX-Langchain-DeepAgent</div>
            <div role="option">HX-Qdrant</div>
            <div role="option">HX-Semantic-Router</div>
            <div role="option">HX-n8n</div>
          </div>
        </div>
        <div>
          <span role="combobox" aria-autocomplete="list" aria-expanded="false" aria-owns="bb-customSelect-iEqdM-panel" aria-activedescendant="bb-customSelect-iEqdM-selectedOption" tabIndex={0}>
            <span>Host</span>
          </span>
          <select className="cursor-pointer max-w-[180px]" aria-label="Filter by host" tabIndex={-1} defaultValue="">
            <option value="">Host</option>
            <option>HX-10</option>
            <option>HX-12</option>
            <option>HX-14</option>
            <option>HX-15</option>
            <option>HX-18</option>
            <option>HX-4 / HX-18</option>
          </select>
          <div id="bb-customSelect-iEqdM-panel" role="listbox">
            <div role="option" id="bb-customSelect-iEqdM-selectedOption">Host</div>
            <div role="option">HX-10</div>
            <div role="option">HX-12</div>
            <div role="option">HX-14</div>
            <div role="option">HX-15</div>
            <div role="option">HX-18</div>
            <div role="option">HX-4 / HX-18</div>
          </div>
        </div>
        <div>
          <span role="combobox" aria-autocomplete="list" aria-expanded="false" aria-owns="bb-customSelect-6Uqzp-panel" aria-activedescendant="bb-customSelect-6Uqzp-selectedOption" tabIndex={0}>
            <span>Work unit</span>
          </span>
          <select className="cursor-pointer max-w-[180px]" aria-label="Filter by unit" tabIndex={-1} defaultValue="">
            <option value="">Work unit</option>
            <option>3C</option>
            <option>MVP 4</option>
            <option>MVP 5</option>
            <option>Phase 2</option>
            <option>Rebuild</option>
            <option>UI</option>
          </select>
          <div id="bb-customSelect-6Uqzp-panel" role="listbox">
            <div role="option" id="bb-customSelect-6Uqzp-selectedOption">Work unit</div>
            <div role="option">3C</div>
            <div role="option">MVP 4</div>
            <div role="option">MVP 5</div>
            <div role="option">Phase 2</div>
            <div role="option">Rebuild</div>
            <div role="option">UI</div>
          </div>
        </div>
        <div>
          <span role="combobox" aria-autocomplete="list" aria-expanded="false" aria-owns="bb-customSelect-8UMRm-panel" aria-activedescendant="bb-customSelect-8UMRm-selectedOption" tabIndex={0}>
            <span>Priority</span>
          </span>
          <select className="cursor-pointer max-w-[180px]" aria-label="Filter by priority" tabIndex={-1} defaultValue="">
            <option value="">Priority</option>
            <option>P1</option>
            <option>P2</option>
          </select>
          <div id="bb-customSelect-8UMRm-panel" role="listbox">
            <div role="option" id="bb-customSelect-8UMRm-selectedOption">Priority</div>
            <div role="option">P1</div>
            <div role="option">P2</div>
          </div>
        </div>
        <div>
          <span role="combobox" aria-autocomplete="list" aria-expanded="false" aria-owns="bb-customSelect-szAyn-panel" aria-activedescendant="bb-customSelect-szAyn-selectedOption" tabIndex={0}>
            <span>Status</span>
          </span>
          <select className="cursor-pointer max-w-[180px]" aria-label="Filter by status" tabIndex={-1} defaultValue="">
            <option value="">Status</option>
            <option>Blocked</option>
            <option>Done · repository outcome</option>
            <option>Paused · next owner work unit</option>
            <option>Stage 1 reported complete</option>
            <option>Tooling NOT_RUN</option>
            <option>Verification needed</option>
          </select>
          <div id="bb-customSelect-szAyn-panel" role="listbox">
            <div role="option" id="bb-customSelect-szAyn-selectedOption">Status</div>
            <div role="option">Blocked</div>
            <div role="option">Done · repository outcome</div>
            <div role="option">Paused · next owner work unit</div>
            <div role="option">Stage 1 reported complete</div>
            <div role="option">Tooling NOT_RUN</div>
            <div role="option">Verification needed</div>
          </div>
        </div>
        <button className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white text-(--ink) cursor-pointer" id="clear">Reset</button>
      </div>
      <div className="overflow-auto">
        <table className="border-collapse whitespace-nowrap w-full">
          <thead>
            <tr>
              <th className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#fafbfc] text-[#8b95a1] text-[9px] font-semibold tracking-[1px] py-[11px] px-[20px] text-left">OUTCOME</th>
              <th className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#fafbfc] text-[#8b95a1] text-[9px] font-semibold tracking-[1px] py-[11px] px-[20px] text-left">STATE / OWNER</th>
              <th className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#fafbfc] text-[#8b95a1] text-[9px] font-semibold tracking-[1px] py-[11px] px-[20px] text-left">HEAD / HOST</th>
              <th className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#fafbfc] text-[#8b95a1] text-[9px] font-semibold tracking-[1px] py-[11px] px-[20px] text-left" />
            </tr>
          </thead>
          <tbody>
            <tr className={"[&:hover]:bg-none [&:hover]:[background-position:0%_0%] [&:hover]:[background-size:auto_auto] [&:hover]:[background-repeat:repeat] [&:hover]:[background-origin:padding-box] [&:hover]:[background-clip:border-box] [&:hover]:[background-attachment:scroll] [&:hover]:bg-[#fafcfe]"}>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <strong className="text-[#273c54] block font-semibold mb-[4px]">Semantic controller · Stage 2 qualification</strong>
                <small className="text-[#8b95a1] text-[10px]">IRP-04 · HX-Semantic-Router</small>
              </td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <span className="text-[11px] font-medium [color:rgb(57,_118,_239)]"><i className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-current rounded-[50%] inline-block h-[6px] mr-[6px] w-[6px]" />In progress</span>
                <br />
                <small className="text-[#8b95a1] text-[10px]">MVP 4 · CC2</small>
              </td>
              <td className="font-[family-name:monospace] text-[11px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">fc08970<br /><small className="text-[#8b95a1] text-[10px]">HX-18</small></td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Details</button>
              </td>
            </tr>
            <tr className={"[&:hover]:bg-none [&:hover]:[background-position:0%_0%] [&:hover]:[background-size:auto_auto] [&:hover]:[background-repeat:repeat] [&:hover]:[background-origin:padding-box] [&:hover]:[background-clip:border-box] [&:hover]:[background-attachment:scroll] [&:hover]:bg-[#fafcfe]"}>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <strong className="text-[#273c54] block font-semibold mb-[4px]">D3 adapter · O-5(c) closeout</strong>
                <small className="text-[#8b95a1] text-[10px]">IRP-05 · HX-Semantic-Router</small>
              </td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <span className="text-[11px] font-medium [color:rgb(32,_165,_140)]"><i className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-current rounded-[50%] inline-block h-[6px] mr-[6px] w-[6px]" />Complete</span>
                <br />
                <small className="text-[#8b95a1] text-[10px]">MVP 5 · CC1</small>
              </td>
              <td className="font-[family-name:monospace] text-[11px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">19c9085<br /><small className="text-[#8b95a1] text-[10px]">HX-4 / HX-18</small></td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Details</button>
              </td>
            </tr>
            <tr className={"[&:hover]:bg-none [&:hover]:[background-position:0%_0%] [&:hover]:[background-size:auto_auto] [&:hover]:[background-repeat:repeat] [&:hover]:[background-origin:padding-box] [&:hover]:[background-clip:border-box] [&:hover]:[background-attachment:scroll] [&:hover]:bg-[#fafcfe]"}>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <strong className="text-[#273c54] block font-semibold mb-[4px]">DeepAgents · source-led rebuild</strong>
                <small className="text-[#8b95a1] text-[10px]">HX12-01 · HX-Langchain-DeepAgent</small>
              </td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <span className="text-[11px] font-medium [color:rgb(239,_173,_83)]"><i className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-current rounded-[50%] inline-block h-[6px] mr-[6px] w-[6px]" />Waiting</span>
                <br />
                <small className="text-[#8b95a1] text-[10px]">Rebuild · OpenCode / DeepSeek Harness</small>
              </td>
              <td className="font-[family-name:monospace] text-[11px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">Unpinned<br /><small className="text-[#8b95a1] text-[10px]">HX-12</small></td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Details</button>
              </td>
            </tr>
            <tr className={"[&:hover]:bg-none [&:hover]:[background-position:0%_0%] [&:hover]:[background-size:auto_auto] [&:hover]:[background-repeat:repeat] [&:hover]:[background-origin:padding-box] [&:hover]:[background-clip:border-box] [&:hover]:[background-attachment:scroll] [&:hover]:bg-[#fafcfe]"}>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <strong className="text-[#273c54] block font-semibold mb-[4px]">Qdrant · live acceptance</strong>
                <small className="text-[#8b95a1] text-[10px]">RO-01 · HX-Qdrant</small>
              </td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <span className="text-[11px] font-medium [color:rgb(239,_173,_83)]"><i className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-current rounded-[50%] inline-block h-[6px] mr-[6px] w-[6px]" />Waiting</span>
                <br />
                <small className="text-[#8b95a1] text-[10px]">3C · Unassigned</small>
              </td>
              <td className="font-[family-name:monospace] text-[11px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">68053f0<br /><small className="text-[#8b95a1] text-[10px]">HX-10</small></td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Details</button>
              </td>
            </tr>
            <tr className={"[&:hover]:bg-none [&:hover]:[background-position:0%_0%] [&:hover]:[background-size:auto_auto] [&:hover]:[background-repeat:repeat] [&:hover]:[background-origin:padding-box] [&:hover]:[background-clip:border-box] [&:hover]:[background-attachment:scroll] [&:hover]:bg-[#fafcfe]"}>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <strong className="text-[#273c54] block font-semibold mb-[4px]">Agent Lab · run contract &amp; model picker</strong>
                <small className="text-[#8b95a1] text-[10px]">IRP-UI · HX-Agent-Lab</small>
              </td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <span className="text-[11px] font-medium [color:rgb(239,_173,_83)]"><i className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-current rounded-[50%] inline-block h-[6px] mr-[6px] w-[6px]" />Waiting</span>
                <br />
                <small className="text-[#8b95a1] text-[10px]">UI · CC1</small>
              </td>
              <td className="font-[family-name:monospace] text-[11px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">06475ac<br /><small className="text-[#8b95a1] text-[10px]">HX-15</small></td>
              <td className="text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal [border-bottom:1px_solid_rgb(237,240,243)]">
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Details</button>
              </td>
            </tr>
            <tr className={"[&:hover]:bg-none [&:hover]:[background-position:0%_0%] [&:hover]:[background-size:auto_auto] [&:hover]:[background-repeat:repeat] [&:hover]:[background-origin:padding-box] [&:hover]:[background-clip:border-box] [&:hover]:[background-attachment:scroll] [&:hover]:bg-[#fafcfe]"}>
              <td className="border-0 text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal">
                <strong className="text-[#273c54] block font-semibold mb-[4px]">n8n · Phase 2</strong>
                <small className="text-[#8b95a1] text-[10px]">HX14-02 · HX-n8n</small>
              </td>
              <td className="border-0 text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal">
                <span className="text-[11px] font-medium [color:rgb(239,_173,_83)]"><i className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-current rounded-[50%] inline-block h-[6px] mr-[6px] w-[6px]" />Waiting</span>
                <br />
                <small className="text-[#8b95a1] text-[10px]">Phase 2 · Unassigned</small>
              </td>
              <td className="border-0 font-[family-name:monospace] text-[11px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal">Unpinned<br /><small className="text-[#8b95a1] text-[10px]">HX-14</small></td>
              <td className="border-0 text-[12px] max-w-[360px] min-w-[100px] py-[15px] px-[20px] whitespace-normal">
                <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Details</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ImportedSectionReviewQueue() {
  return (
    <section className="panel bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-white rounded-[10px] [box-shadow:rgba(20,45,78,0.01)_0px_2px_7px] overflow-hidden [border:1px_solid_var(--line)]">
      <div className="panelhead items-center flex justify-between [border-bottom:1px_solid_var(--line)] [@media(max-width:760px)]:flex-wrap [@media(max-width:760px)]:gap-[10px]">
        <h2 className="tracking-[-0.2px] m-0">Review queue</h2>
        <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#edf2fc] rounded-[5px] text-[#3662a4] text-[10px] py-[4px] px-[7px]">6 open</span>
      </div>
      <div className="queue-row items-center grid gap-[12px] grid-cols-[7px_1fr_auto] py-[15px] px-[20px]">
        <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#e9a44c] rounded-[50%] h-[6px] w-[6px]" />
        <div>
          <strong className="block text-[12px] font-semibold mt-0 mr-0 mb-[5px] ml-0">
            <a className="text-(--blue) cursor-pointer no-underline" href="https://github.com/HX-Infratstructure/HX-Semantic-Router/pull/17" rel="noopener noreferrer" target="_blank">Semantic-Router#17 ↗</a>
          </strong>
          <small className="text-(--muted) text-[10px]">Open · ready flag · <span className="font-[family-name:monospace] text-[10px]">859c37f</span></small>
        </div>
        <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Inspect</button>
      </div>
      <div className="queue-row items-center grid gap-[12px] grid-cols-[7px_1fr_auto] py-[15px] px-[20px]">
        <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#e9a44c] rounded-[50%] h-[6px] w-[6px]" />
        <div>
          <strong className="block text-[12px] font-semibold mt-0 mr-0 mb-[5px] ml-0">
            <a className="text-(--blue) cursor-pointer no-underline" href="https://github.com/HX-Infratstructure/HX-Repo-Optimization/pull/83" rel="noopener noreferrer" target="_blank">Repo-Optimization#83 ↗</a>
          </strong>
          <small className="text-(--muted) text-[10px]">Draft · <span className="font-[family-name:monospace] text-[10px]">1c18c26</span></small>
        </div>
        <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Inspect</button>
      </div>
      <div className="queue-row items-center grid gap-[12px] grid-cols-[7px_1fr_auto] py-[15px] px-[20px]">
        <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#e9a44c] rounded-[50%] h-[6px] w-[6px]" />
        <div>
          <strong className="block text-[12px] font-semibold mt-0 mr-0 mb-[5px] ml-0">
            <a className="text-(--blue) cursor-pointer no-underline" href="https://github.com/HX-Infratstructure/HX-Software-Factory/pull/10" rel="noopener noreferrer" target="_blank">Software-Factory#10 ↗</a>
          </strong>
          <small className="text-(--muted) text-[10px]">Open · search result · <span className="font-[family-name:monospace] text-[10px]">Unpinned</span></small>
        </div>
        <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Inspect</button>
      </div>
      <div className="queue-row items-center grid gap-[12px] grid-cols-[7px_1fr_auto] py-[15px] px-[20px]">
        <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#e9a44c] rounded-[50%] h-[6px] w-[6px]" />
        <div>
          <strong className="block text-[12px] font-semibold mt-0 mr-0 mb-[5px] ml-0">
            <a className="text-(--blue) cursor-pointer no-underline" href="https://github.com/HX-Infratstructure/HX-Software-Factory/pull/9" rel="noopener noreferrer" target="_blank">Software-Factory#9 ↗</a>
          </strong>
          <small className="text-(--muted) text-[10px]">Open · search result · <span className="font-[family-name:monospace] text-[10px]">Unpinned</span></small>
        </div>
        <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Inspect</button>
      </div>
      <div className="queue-row items-center grid gap-[12px] grid-cols-[7px_1fr_auto] py-[15px] px-[20px]">
        <span className="bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-[#e9a44c] rounded-[50%] h-[6px] w-[6px]" />
        <div>
          <strong className="block text-[12px] font-semibold mt-0 mr-0 mb-[5px] ml-0">
            <a className="text-(--blue) cursor-pointer no-underline" href="https://github.com/HX-Infratstructure/HX-n8n-MCP-QA/pull/15" rel="noopener noreferrer" target="_blank">n8n-MCP-QA#15 ↗</a>
          </strong>
          <small className="text-(--muted) text-[10px]">Open · search result · <span className="font-[family-name:monospace] text-[10px]">Unpinned</span></small>
        </div>
        <button className="linkbtn bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Inspect</button>
      </div>
      <div className="dash-body">
        <p className="chart-note text-(--muted) text-[10px] leading-normal" style={{ marginTop: "0px" }}>Open does not mean merge-ready. Review evidence and deployment authorization are separate.</p>
        <button className="panel-action bg-none [background-position:0%_0%] [background-size:auto_auto] [background-repeat:repeat] [background-origin:padding-box] [background-clip:border-box] [background-attachment:scroll] bg-transparent text-(--blue) cursor-pointer">Full review queue →</button>
      </div>
    </section>
  );
}
