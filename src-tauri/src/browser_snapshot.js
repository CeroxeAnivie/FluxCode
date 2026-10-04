(() => {
  const text = document.body?.innerText ?? '';
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    text: text.slice(0, 20000),
    truncated: text.length > 20000,
    links: Array.from(document.links).filter((link) => /^https?:$/.test(link.protocol)).slice(0, 80).map((link) => ({
      text: (link.innerText || link.title || link.href).slice(0, 200),
      url: link.href.slice(0, 2000)
    }))
  };
})()
