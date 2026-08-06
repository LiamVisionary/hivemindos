/* ============================================================================
   scroll-world — portable scroll-scrubbed camera-flight engine
   ----------------------------------------------------------------------------
   Adapted from oso95/scroll-world at commit
   2912048246d057cdfe134dfc0b4dfb7e6a12f30e (MIT).

   Framework-agnostic and dependency-free. It builds namespaced DOM/CSS inside
   the supplied container and supports still-only starters plus optional
   frame-matched desktop/mobile video chains.
   ========================================================================== */

function mountScrollWorld(container, config) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const smallMQ = window.matchMedia("(max-width: 860px)");
  const isMobile = () => coarse || smallMQ.matches;
  const sections = config.sections || [];
  const connectors = config.connectors || [];
  const mobileConnectors = config.connectorsMobile || [];
  const diveWeight = config.diveScroll || 1.3;
  const connectorWeight = config.connScroll || 0.9;
  const crossfade = config.crossfade != null ? config.crossfade : 0.12;
  if (!container || !sections.length) return;

  injectScrollWorldCSS();
  container.classList.add("sw-root");

  const segments = [];
  sections.forEach((section, index) => {
    const dive = {
      kind: "dive",
      sectionIndex: index,
      clip: section.clip,
      mobileClip: section.clipMobile,
      still: section.still,
      mobileStill: section.stillMobile,
      accent: section.accent,
      weight: section.scroll || diveWeight,
      linger: section.linger || 0,
    };
    segments.push(dive);
    section._segment = dive;
    if (index < sections.length - 1 && connectors[index]) {
      segments.push({
        kind: "connector",
        sectionIndex: index,
        clip: connectors[index],
        mobileClip: mobileConnectors[index],
        still: sections[index + 1].still,
        mobileStill: sections[index + 1].stillMobile,
        accent: sections[index + 1].accent,
        weight: connectorWeight,
        linger: 0,
      });
    }
  });

  const sky = element("div", "sw-sky");
  if (config.atmosphere !== false) {
    sky.appendChild(element("div", "sw-sky__grad"));
    sky.appendChild(element("div", "sw-sky__glow"));
  }
  const particles = element("div", "sw-particles");
  sky.appendChild(particles);

  const progress = element("div", "sw-scrollbar");
  const progressFill = element("span");
  progress.appendChild(progressFill);

  const topbar = element("div", "sw-topbar");
  if (config.brand) {
    const brand = element("a", "sw-brand");
    brand.href = config.brand.href || "#";
    brand.appendChild(element("span", "sw-brand__mark"));
    const name = element("span", "sw-brand__name");
    name.textContent = config.brand.name || "";
    brand.appendChild(name);
    topbar.appendChild(brand);
  }
  const nav = element("nav", "sw-nav");
  if (config.nav !== false) topbar.appendChild(nav);
  if (config.cta?.label) {
    const action = element("a", "sw-topcta");
    action.href = config.cta.href || "#";
    action.textContent = config.cta.label;
    topbar.appendChild(action);
  }

  const stage = element("div", "sw-stage");
  const copyLayer = element("div", "sw-copylayer");
  const route = element("div", "sw-route");
  const hint = element("div", "sw-hint");
  const hintText = element("span");
  hintText.textContent = config.hint || "scroll";
  hint.appendChild(hintText);
  hint.appendChild(element("i"));
  const track = element("div", "sw-track");

  [sky, progress, topbar, stage, copyLayer, route, hint, track].forEach((node) => {
    container.appendChild(node);
  });

  segments.forEach((segment) => {
    const scene = element("div", "sw-scene");
    scene.style.setProperty("--sw-accent", segment.accent || "");
    const image = element("img", "sw-scene__still");
    image.alt = "";
    image.decoding = "async";
    image.loading = "lazy";
    image.src = isMobile() && segment.mobileStill ? segment.mobileStill : segment.still || "";
    scene.appendChild(image);
    stage.appendChild(scene);
    Object.assign(segment, {
      element: scene,
      image,
      video: null,
      hasClip: false,
      loading: false,
      ready: false,
      current: 0,
      target: 0,
      visible: false,
    });
  });

  const copies = [];
  const dots = [];
  sections.forEach((section, index) => {
    const copy = element("article", "sw-copy");
    copy.style.setProperty("--sw-accent", section.accent || "");
    copy.appendChild(textElement("span", "sw-copy__num", `${pad(index + 1)} / ${pad(sections.length)}`));
    if (section.eyebrow) copy.appendChild(textElement("span", "sw-copy__eyebrow", section.eyebrow));
    if (section.title) copy.appendChild(textElement("h2", "sw-copy__title", section.title));
    if (section.body) copy.appendChild(textElement("p", "sw-copy__body", section.body));
    if (section.tags?.length) {
      const tags = element("ul", "sw-copy__tags");
      section.tags.forEach((tag) => tags.appendChild(textElement("li", "", tag)));
      copy.appendChild(tags);
    }
    if (section.cta) copy.appendChild(callToAction(section.cta));
    copyLayer.appendChild(copy);
    copies.push(copy);

    const dot = element("button", "sw-route__dot");
    dot.type = "button";
    dot.style.setProperty("--sw-accent", section.accent || "");
    dot.appendChild(textElement("span", "sw-route__label", section.label || ""));
    dot.appendChild(element("i"));
    dot.addEventListener("click", () => jumpTo(index));
    route.appendChild(dot);
    dots.push(dot);

    if (config.nav !== false) {
      const navItem = textElement("button", "sw-nav__item", section.label || "");
      navItem.type = "button";
      navItem.addEventListener("click", () => jumpTo(index));
      nav.appendChild(navItem);
    }
  });

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const smooth = (value) => {
    const clamped = clamp(value);
    return clamped * clamped * (3 - 2 * clamped);
  };
  const lingerEase = (value, linger) => {
    const amount = clamp(linger);
    const centered = value - 0.5;
    return (1 - amount) * value + amount * (4 * centered ** 3 + 0.5);
  };

  let viewportHeight = window.innerHeight;
  let stageOffset = 0;
  let totalWeight = 0;
  let activeSection = -1;
  let ticking = false;
  let layoutWidth = window.innerWidth;
  let userReady = false;

  function layout() {
    viewportHeight = window.innerHeight;
    layoutWidth = window.innerWidth;
    stageOffset = window.innerWidth > 860 ? 4 : 0;
    let offset = 0;
    segments.forEach((segment) => {
      segment.start = offset * viewportHeight;
      offset += segment.weight;
      segment.end = offset * viewportHeight;
    });
    totalWeight = offset;
    track.style.height = `${totalWeight * viewportHeight + viewportHeight}px`;
    read();
  }

  function jumpTo(index) {
    const segment = sections[index]._segment;
    window.scrollTo({
      top: segment.start + (segment.end - segment.start) * 0.5,
      behavior: reduce ? "auto" : "smooth",
    });
  }

  function primeVideo(video) {
    if (!isMobile() || !video) return;
    try {
      const play = video.play();
      if (play?.then) play.then(() => video.pause()).catch(() => {});
    } catch {}
  }

  function loadClip(segment) {
    if (reduce || segment.loading || !segment.clip) return;
    segment.loading = true;
    const url = isMobile() && segment.mobileClip ? segment.mobileClip : segment.clip;
    fetch(url)
      .then((response) => response.ok ? response.blob() : Promise.reject(new Error("Media unavailable")))
      .then((blob) => {
        const video = document.createElement("video");
        video.className = "sw-scene__video";
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.setAttribute("muted", "");
        video.setAttribute("playsinline", "");
        video.src = URL.createObjectURL(blob);
        video.addEventListener("loadedmetadata", () => {
          segment.ready = true;
          read();
        });
        video.addEventListener("seeked", () => segment.element.classList.add("has-clip"), { once: true });
        video.addEventListener("loadeddata", () => {
          video.pause();
          if (userReady) primeVideo(video);
        });
        segment.element.appendChild(video);
        segment.video = video;
        segment.hasClip = true;
      })
      .catch(() => {
        segment.loading = false;
      });
  }

  function read() {
    const scrollY = window.scrollY || window.pageYOffset;
    const fade = crossfade * viewportHeight;
    let currentIndex = 0;
    for (let index = 0; index < segments.length; index += 1) {
      if (scrollY >= segments[index].start) currentIndex = index;
    }

    segments.forEach((segment, index) => {
      if (scrollY > segment.start - 1.6 * viewportHeight && scrollY < segment.end + 1.6 * viewportHeight) {
        loadClip(segment);
      }
      const local = clamp((scrollY - segment.start) / (segment.end - segment.start));
      segment.target = segment.linger ? lingerEase(local, segment.linger) : local;
      let outside = 0;
      if (scrollY < segment.start) outside = segment.start - scrollY;
      else if (scrollY > segment.end) outside = scrollY - segment.end;
      const opacity = smooth(1 - outside / fade);
      segment.element.style.opacity = opacity;
      segment.visible = opacity > 0.001;
      segment.element.style.zIndex = index === currentIndex ? "120" : String(100 + Math.round(opacity * 10));
      if (!segment.hasClip || !segment.ready) {
        const scale = reduce ? 1 : 1.03 + local * 0.14;
        segment.image.style.transform = `translateX(${stageOffset - 2}vw) scale(${scale.toFixed(3)})`;
      }
    });

    sections.forEach((section, index) => {
      const segment = section._segment;
      const progressValue = clamp((scrollY - segment.start) / (segment.end - segment.start));
      const before = scrollY < segment.start;
      const after = scrollY > segment.end;
      let opacity;
      if (index === 0) opacity = after ? 0 : smooth(1 - progressValue / 0.62);
      else if (index === sections.length - 1) opacity = before ? 0 : smooth(progressValue / 0.4);
      else opacity = before || after ? 0 : smooth(1 - Math.abs(progressValue - 0.5) / 0.5);
      copies[index].style.opacity = opacity;
      copies[index].style.transform = reduce ? "none" : `translateY(${(0.5 - progressValue) * 4}vh)`;
      copies[index].style.pointerEvents = opacity > 0.5 ? "auto" : "none";
    });

    const current = segments[currentIndex];
    const nearby = clamp(
      current.kind === "dive"
        ? current.sectionIndex
        : (scrollY - current.start) / (current.end - current.start) > 0.5
          ? current.sectionIndex + 1
          : current.sectionIndex,
      0,
      sections.length - 1,
    );
    if (nearby !== activeSection) {
      activeSection = nearby;
      dots.forEach((dot, index) => dot.classList.toggle("is-active", index === nearby));
      nav.querySelectorAll(".sw-nav__item").forEach((item, index) => {
        item.classList.toggle("is-active", index === nearby);
      });
      container.style.setProperty("--sw-accent", sections[nearby].accent || "");
    }
    progressFill.style.transform = `scaleX(${clamp(scrollY / (totalWeight * viewportHeight))})`;
    hint.style.opacity = clamp(1 - scrollY / (0.5 * viewportHeight));
    particles.style.transform = `translate3d(0, ${-scrollY * 0.05}px, 0)`;
    ticking = false;
  }

  function animateVideos() {
    const threshold = isMobile() ? 0.02 : 0.008;
    segments.forEach((segment) => {
      if (!segment.hasClip || !segment.ready || !segment.video || segment.video.seeking) return;
      if (!segment.visible && Math.abs(segment.current - segment.target) < 0.002) return;
      segment.current += (segment.target - segment.current) * (reduce ? 1 : 0.18);
      const time = clamp(segment.current, 0, 0.999) * (segment.video.duration || 1);
      if (Math.abs(segment.video.currentTime - time) > threshold) {
        try {
          segment.video.currentTime = time;
        } catch {}
      }
    });
    requestAnimationFrame(animateVideos);
  }

  function onFirstGesture() {
    if (userReady) return;
    userReady = true;
    segments.forEach((segment) => primeVideo(segment.video));
  }

  function onResize() {
    if (coarse && window.innerWidth === layoutWidth) return;
    layout();
  }

  seedParticles(particles, reduce || coarse);
  window.addEventListener("pointerdown", onFirstGesture, { once: true, passive: true });
  window.addEventListener("touchstart", onFirstGesture, { once: true, passive: true });
  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(read);
    }
  }, { passive: true });
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", layout);
  window.addEventListener("load", layout);
  layout();
  requestAnimationFrame(animateVideos);
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textElement(tag, className, value) {
  const node = element(tag, className);
  node.textContent = String(value);
  return node;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function callToAction(config) {
  const group = element("div", "sw-copy__cta");
  [["primary", "sw-btn sw-btn--primary"], ["secondary", "sw-btn sw-btn--ghost"]].forEach(([key, className]) => {
    const item = config[key];
    if (!item) return;
    const link = textElement("a", className, item.label || "");
    link.href = item.href || "#";
    group.appendChild(link);
  });
  return group;
}

function seedParticles(host, reduce) {
  if (!host || reduce) return;
  const kinds = ["dot", "dot", "ring"];
  const seeds = [7, 23, 41, 58, 71, 88, 12, 34, 52, 66, 83, 95, 18, 29, 47, 63, 77, 91, 5, 38];
  for (let index = 0; index < 20; index += 1) {
    const particle = document.createElement("span");
    particle.className = `sw-pt sw-pt--${kinds[index % kinds.length]}`;
    particle.style.left = `${seeds[index]}vw`;
    particle.style.top = `${(seeds[(index * 3) % seeds.length] * 1.3) % 100}vh`;
    particle.style.setProperty("--sw-sc", (0.5 + (seeds[(index * 5) % seeds.length] % 60) / 60 * 1.1).toFixed(2));
    const duration = 14 + seeds[(index * 7) % seeds.length] % 22;
    particle.style.animationDuration = `${duration}s`;
    particle.style.animationDelay = `${-(seeds[(index * 2) % seeds.length] % duration)}s`;
    host.appendChild(particle);
  }
}

function injectScrollWorldCSS() {
  if (document.getElementById("sw-css")) return;
  const css = `
  .sw-root{--sw-bg:#f5ede0;--sw-ink:#241d2b;--sw-ink-soft:#6a6072;--sw-accent:#8a7bb5;
    --sw-font-display:ui-rounded,"SF Pro Rounded","Segoe UI",system-ui,sans-serif;
    --sw-font-body:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif;
    color:var(--sw-ink);font-family:var(--sw-font-body);}
  html,body{margin:0;background:var(--sw-bg,#f5ede0);overflow-x:hidden;}
  .sw-sky{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--sw-bg);}
  .sw-sky__grad{position:absolute;inset:-10%;background:linear-gradient(178deg,color-mix(in srgb,var(--sw-accent) 12%,var(--sw-bg)) 0%,var(--sw-bg) 55%,color-mix(in srgb,var(--sw-accent) 6%,var(--sw-bg)) 100%);}
  .sw-sky__glow{position:absolute;inset:0;background:radial-gradient(60% 42% at 74% 16%,color-mix(in srgb,var(--sw-accent) 22%,transparent),transparent 70%),radial-gradient(46% 34% at 50% 50%,color-mix(in srgb,#fff 45%,transparent),transparent 70%);}
  .sw-particles{position:absolute;inset:-6% -2%;will-change:transform;}
  .sw-pt{position:absolute;width:13px;height:13px;transform:scale(var(--sw-sc,1));opacity:0;animation:sw-drift linear infinite;}
  .sw-pt::before{content:"";position:absolute;inset:0;border-radius:50%;}
  .sw-pt--dot::before{background:radial-gradient(circle at 34% 30%,color-mix(in srgb,var(--sw-accent) 60%,#000),#000 82%);}
  .sw-pt--ring::before{background:transparent;border:2px solid color-mix(in srgb,var(--sw-accent) 55%,transparent);}
  @keyframes sw-drift{0%{opacity:0;transform:scale(var(--sw-sc)) translate(0,12vh) rotate(0)}12%{opacity:.5}88%{opacity:.45}100%{opacity:0;transform:scale(var(--sw-sc)) translate(4vw,-22vh) rotate(210deg)}}
  .sw-scrollbar{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-scrollbar span{display:block;height:100%;width:100%;transform-origin:0 50%;transform:scaleX(0);background:var(--sw-accent);}
  .sw-topbar{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:clamp(14px,2.4vw,26px) clamp(18px,5vw,64px);}
  .sw-brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--sw-ink);}
  .sw-brand__mark{width:24px;height:28px;border-radius:7px 7px 10px 10px;background:linear-gradient(160deg,var(--sw-accent),color-mix(in srgb,var(--sw-accent) 60%,#000));box-shadow:0 6px 14px color-mix(in srgb,var(--sw-accent) 40%,transparent);}
  .sw-brand__name{font-family:var(--sw-font-display);font-weight:700;font-size:1.1rem;}
  .sw-nav{display:flex;gap:4px;padding:5px;background:color-mix(in srgb,#fff 55%,transparent);backdrop-filter:blur(10px);border:1px solid color-mix(in srgb,var(--sw-accent) 16%,transparent);border-radius:999px;}
  .sw-nav__item{font:inherit;font-size:.82rem;color:var(--sw-ink-soft);border:0;background:transparent;cursor:pointer;padding:7px 14px;border-radius:999px;transition:color .25s,background .25s;}
  .sw-nav__item:hover{color:var(--sw-ink)}.sw-nav__item.is-active{color:#fff;background:var(--sw-accent);}
  .sw-topcta{text-decoration:none;font-weight:600;font-size:.9rem;color:#fff;background:var(--sw-ink);padding:10px 20px;border-radius:999px;white-space:nowrap;}
  .sw-stage{position:fixed;inset:0;z-index:10;pointer-events:none;}
  .sw-scene{position:absolute;inset:0;opacity:0;overflow:hidden;will-change:opacity;}
  .sw-scene__video,.sw-scene__still{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center 42%;}
  .sw-scene__still{will-change:transform}.sw-scene.has-clip .sw-scene__still{opacity:0}.sw-scene__video{z-index:1;}
  .sw-copylayer{position:fixed;inset:0;z-index:20;pointer-events:none;}
  .sw-copylayer::before{content:"";position:absolute;inset:0;width:min(58vw,780px);background:linear-gradient(90deg,var(--sw-bg) 0%,color-mix(in srgb,var(--sw-bg) 82%,transparent) 34%,color-mix(in srgb,var(--sw-bg) 40%,transparent) 62%,transparent 100%);}
  .sw-copy{position:absolute;left:clamp(18px,5vw,64px);top:50%;transform:translateY(-50%);width:min(42vw,460px);opacity:0;will-change:opacity,transform;}
  .sw-copy__num{font-family:ui-monospace,Menlo,monospace;font-size:.74rem;letter-spacing:.12em;color:var(--sw-ink-soft);}
  .sw-copy__eyebrow{display:block;margin-top:18px;font-family:var(--sw-font-display);font-weight:700;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase;color:var(--sw-accent);}
  .sw-copy__title{font-family:var(--sw-font-display);font-weight:700;color:var(--sw-ink);font-size:clamp(2rem,4.4vw,3.5rem);line-height:1.03;margin:12px 0 0;letter-spacing:-.01em;text-shadow:0 2px 20px color-mix(in srgb,var(--sw-bg) 70%,transparent);}
  .sw-copy__body{margin-top:18px;font-size:clamp(1rem,1.25vw,1.14rem);line-height:1.55;color:color-mix(in srgb,var(--sw-ink) 78%,var(--sw-ink-soft));max-width:40ch;text-shadow:0 1px 12px color-mix(in srgb,var(--sw-bg) 90%,transparent);}
  .sw-copy__tags{list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:24px 0 0;padding:0;}
  .sw-copy__tags li{font-size:.82rem;font-weight:600;color:color-mix(in srgb,var(--sw-accent) 70%,#000);padding:7px 14px;border-radius:999px;background:color-mix(in srgb,var(--sw-accent) 14%,#fff);border:1px solid color-mix(in srgb,var(--sw-accent) 30%,transparent);}
  .sw-copy__cta{display:flex;flex-wrap:wrap;gap:12px;margin-top:28px;pointer-events:auto;}
  .sw-btn{text-decoration:none;font-weight:600;font-size:.95rem;padding:13px 24px;border-radius:999px;transition:transform .2s;}
  .sw-btn--primary{color:#fff;background:var(--sw-ink)}.sw-btn--primary:hover{transform:translateY(-2px)}
  .sw-btn--ghost{color:var(--sw-ink);border:1.5px solid color-mix(in srgb,var(--sw-ink) 25%,transparent)}.sw-btn--ghost:hover{transform:translateY(-2px)}
  .sw-route{position:fixed;right:clamp(14px,2.4vw,30px);top:50%;z-index:40;transform:translateY(-50%);display:flex;flex-direction:column;gap:22px;padding:18px 10px;}
  .sw-route::before{content:"";position:absolute;left:50%;top:22px;bottom:22px;width:2px;transform:translateX(-50%);background:var(--sw-accent);opacity:.28;}
  .sw-route__dot{position:relative;border:0;background:transparent;cursor:pointer;width:14px;height:14px;display:grid;place-items:center;}
  .sw-route__dot i{width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--sw-accent) 40%,transparent);transition:transform .3s,background .3s,box-shadow .3s;}
  .sw-route__dot:hover i{transform:scale(1.25);background:var(--sw-accent)}
  .sw-route__dot.is-active i{background:var(--sw-accent);transform:scale(1.4);box-shadow:0 0 0 5px color-mix(in srgb,var(--sw-accent) 22%,transparent);}
  .sw-route__label{position:absolute;right:24px;top:50%;transform:translateY(-50%) translateX(6px);white-space:nowrap;font-size:.78rem;font-weight:600;color:var(--sw-ink);background:color-mix(in srgb,#fff 85%,transparent);backdrop-filter:blur(6px);padding:5px 11px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;border:1px solid color-mix(in srgb,var(--sw-accent) 14%,transparent);}
  .sw-route__dot:hover .sw-route__label,.sw-route__dot.is-active .sw-route__label{opacity:1;transform:translateY(-50%) translateX(0);}
  .sw-hint{position:fixed;left:50%;bottom:26px;z-index:30;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:10px;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sw-ink-soft);transition:opacity .3s;}
  .sw-hint i{width:22px;height:34px;border-radius:12px;border:2px solid color-mix(in srgb,var(--sw-ink) 28%,transparent);position:relative;}
  .sw-hint i::after{content:"";position:absolute;left:50%;top:7px;width:4px;height:7px;border-radius:2px;background:var(--sw-accent);transform:translateX(-50%);animation:sw-wheel 1.7s ease-in-out infinite;}
  @keyframes sw-wheel{0%{opacity:0;top:6px}40%{opacity:1}100%{opacity:0;top:17px}}
  .sw-track{position:relative;z-index:1;width:100%;pointer-events:none;}
  @media (max-width:860px){
    .sw-nav{display:none}
    .sw-copylayer::before{width:100%;height:60%;top:auto;bottom:0;background:linear-gradient(0deg,var(--sw-bg) 8%,color-mix(in srgb,var(--sw-bg) 70%,transparent) 46%,transparent 100%)}
    .sw-copy{left:clamp(18px,5vw,64px);right:clamp(18px,5vw,64px);top:auto;bottom:calc(clamp(56px,12dvh,110px) + env(safe-area-inset-bottom));transform:none;width:auto;max-width:560px}
    .sw-copy__title{font-size:clamp(1.9rem,7.5vw,2.7rem)}
    .sw-copy__body{max-width:none;font-size:clamp(.98rem,3.6vw,1.1rem)}
    .sw-scene__video,.sw-scene__still{object-position:center 46%}
    .sw-hint{bottom:calc(20px + env(safe-area-inset-bottom))}
    .sw-route{gap:16px;right:6px}.sw-route__label{display:none}
  }
  @media (max-width:860px) and (orientation:portrait){.sw-scene__video,.sw-scene__still{object-position:center 44%}}
  @media (hover:none) and (pointer:coarse){.sw-route{padding:14px 6px}.sw-route__dot{width:28px;height:28px}.sw-btn{padding:15px 26px}}
  @media (prefers-reduced-motion:reduce){.sw-hint i::after{animation:none}.sw-pt{display:none}}
  `;
  const style = document.createElement("style");
  style.id = "sw-css";
  style.textContent = `@layer sw {\n${css}\n}`;
  document.head.appendChild(style);
}

if (typeof module !== "undefined" && module.exports) module.exports = { mountScrollWorld };
if (typeof window !== "undefined") window.mountScrollWorld = mountScrollWorld;
