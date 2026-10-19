window.addEventListener("DOMContentLoaded", function(indexUrl) {
  let index = null;
  let lookup = null;
  let queuedTerm = null;
  let queuedDoNotAddState = false;
  let origContent = null;

  const form = document.getElementById("search");
  const input = document.getElementById("search-input");

  // LOCAL CHANGE (comunizm): results are shown only on the homepage. A search started on any other page
  // redirects to <home>/#search=<term>, and the homepage starts the search from that hash on load.
  // Upstream replaced the main container in place on every page, leaving the page header behind.
  const homeUrl = new URL(document.querySelector(".navbar-brand").href, window.location.href);

  function isHomePage() {
    return window.location.pathname === homeUrl.pathname;
  }

  function searchHash(term) {
    return "#search=" + encodeURIComponent(term);
  }

  form.addEventListener("submit", function(event) {
    event.preventDefault();

    let term = input.value.trim();
    if (!term) {
      return;
    }
    if (!isHomePage()) {
      window.location.assign(homeUrl.pathname + searchHash(term));
      return;
    }
    startSearch(term, false);
  }, false);

  // Search requested through the URL hash (redirect from another page, bookmark, shared link).
  let hashTerm = null;
  if (window.location.hash.indexOf("#search=") === 0) {
    try {
      hashTerm = decodeURIComponent(window.location.hash.slice("#search=".length)).trim();
    }
    catch (e) {
      hashTerm = null;
    }
  }

  if (hashTerm && !isHomePage()) {
    // old links such as /despre/#search=kurz: send them to the homepage
    window.location.replace(homeUrl.pathname + searchHash(hashTerm));
  }
  else if (history.state && history.state.type == "search") {
    startSearch(history.state.term, true);
  }
  else if (hashTerm) {
    // mark this history entry so that a reload or "back" keeps working like a normal search
    history.replaceState({type: "search", term: hashTerm}, "", window.location.href);
    startSearch(hashTerm, true);
  }

  window.addEventListener("popstate", function(event) {
    if (event.state && event.state.type == "search") {
      startSearch(event.state.term, true);
    }
    else if (origContent) {
      let target = document.querySelector(".container[role=main]");
      while (target.firstChild) {
        target.removeChild(target.firstChild);
      }

      for (let node of origContent) {
        target.appendChild(node);
      }
      origContent = null;
    }
  }, false);

  function startSearch(term, doNotAddState) {
    input.value = term;
    form.setAttribute("data-running", "true");
    if (index) {
      search(term, doNotAddState);
    }
    else if (queuedTerm) {
      queuedTerm = term;
      queuedDoNotAddState = doNotAddState;
    }
    else {
      queuedTerm = term;
      queuedDoNotAddState = doNotAddState;
      initIndex();
    }
  }

  function searchDone() {
    form.removeAttribute("data-running");

    queuedTerm = null;
    queuedDoNotAddState = false;
  }

  function initIndex() {
    let request = new XMLHttpRequest();
    request.open("GET", indexUrl);
    request.responseType = "json";
    request.addEventListener("load", function(event) {
      let documents = request.response;
      if (!documents)
      {
        console.error("Search index could not be downloaded.");
        searchDone();
        return;
      }

      lookup = {};
      index = lunr(function() {
        const language = document.documentElement.getAttribute("lang") || "en";
        if (language.length > 2)
          language = language.slice(0, 2);
        if (language != "en" && lunr.hasOwnProperty(language)) {
          this.use(lunr[language]);
        }

        this.ref("uri");
        this.field("title");
        this.field("subtitle");
        this.field("content");
        this.field("description");
        this.field("categories");
        this.field("tags");

        for (let document of documents) {
          this.add(document);
          lookup[document.uri] = document;
        }
      });

      search(queuedTerm, queuedDoNotAddState);
    }, false);
    request.addEventListener("error", searchDone, false);
    request.send(null);
  }

  function search(term, doNotAddState) {
    try {
      let results = index.search(term);

      let target = document.querySelector(".container[role=main]");
      let replaced = [];
      while (target.firstChild) {
        replaced.push(target.firstChild);
        target.removeChild(target.firstChild);
      }
      if (!origContent) {
        origContent = replaced;
      }

      let titleTemplate = document.getElementById("search-heading");
      let titleElement = titleTemplate.content.cloneNode(true);
      // This is an overly simple pluralization scheme, it will only work
      // for some languages.

      let title = titleElement.querySelector(".search-title");
      if (results.length == 0) {
        title.textContent = titleTemplate.getAttribute("data-results-none").replace("{}", term);
      }
      else if (results.length == 1) {
        title.textContent = titleTemplate.getAttribute("data-results-one").replace("{}", term);
      }
      else {
        title.textContent = titleTemplate.getAttribute("data-results-many").replace("{}", term).replace("13579", results.length);
      }
      target.appendChild(titleElement);
      document.title = title.textContent;

      let template = document.getElementById("search-result");
      for (let result of results) {
          let doc = lookup[result.ref];

          let element = template.content.cloneNode(true);
          element.querySelector(".summary-title-link").href = element.querySelector(".read-more-link").href = doc.uri;
          element.querySelector(".summary-title-link").textContent = doc.title;
          element.querySelector(".post-entry").textContent = truncateToEndOfSentence(doc.content, 70);
          target.appendChild(element);
      }
      title.scrollIntoView(true);

      if (!doNotAddState) {
          history.pushState({type: "search", term: term}, title.textContent, "#search=" + encodeURIComponent(term));
      }

      // LOCAL CHANGE (comunizm): close the mobile menu only if it is really open. Upstream checked for the
      // "collapsed" class, which a freshly loaded page never has, so the click OPENED the menu after a redirect.
      let menuToggler = document.querySelector(".navbar-toggler");
      if (menuToggler && menuToggler.getAttribute("aria-expanded") === "true") {
        menuToggler.click();
      }
    }
    finally {
      searchDone();
    }
  }

  // This matches Hugo's own summary logic:
  // https://github.com/gohugoio/hugo/blob/b5f39d23b86f9cb83c51da9fe4abb4c19c01c3b7/helpers/content.go#L543
  function truncateToEndOfSentence(text, minWords)
  {
      let match;
      let result = "";
      let wordCount = 0;
      let regexp = /(\S+)(\s*)/g;
      while (match = regexp.exec(text)) {
          wordCount++;
          if (wordCount <= minWords) {
              result += match[0];
          }
          else
          {
              let char1 = match[1][match[1].length - 1];
              let char2 = match[2][0];
              if (/[.?!"]/.test(char1) || char2 == "\n") {
                  result += match[1];
                  break;
              }
              else {
                  result += match[0];
              }
          }
      }
      return result;
  }
}.bind(null, document.currentScript.getAttribute("data-index")), {once: true});
