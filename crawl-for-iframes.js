"use strict";


const crawlerConfig = Object.freeze({
  recursionDepth: 1, // probably reduce maxSubPages if you increase this!
  maxSubPages: 99, // 100 total, including homepage of site
  scriptTimeout: 20000, // ms
  pageTimeout: 20000, // ms
  sitesListFilePath: require('process').argv[2],
  outputDirPath: "output",
});

const browserConfig = Object.freeze({
  logLevel: 'error',
  path: '/',
  capabilities: {
    browserName: 'firefox',
    'moz:firefoxOptions': {
      // Available options:
      // https://firefox-source-docs.mozilla.org/testing/geckodriver/Capabilities.html
      binary: require('process').env.IFRAME_CRAWLER_FIREFOX_BIN,
      args: [
        "-headless",  // Comment out this line to see the browser!
        //"-profile", "/path/to/profile",
      ],
      prefs: {
        "fission.autostart": true,
        //"fission.frontend.simulate-events": true,
        //"fission.frontend.simulate-messages": true,
        //"fission.rebuild_frameloaders_on_remoteness_change": true,
        //"fission.preserve_browsing_contexts": true,
        //"fission.oopif.attribute": true,
      }
    },
  }
});


const { remote } = require('webdriverio');
const fs = require('fs');
const fsPromises = require('fs').promises;
const readline = require('readline');
const process = require('process');


/**
 * This function is copied to, and run in, the window of each webpage we're
 * interested in.  It gathers all the data that we need in one go before
 * returning it via a JSON object.  Doing it this way rather than by using
 * the normal WebDriver document object API calls means that we avoid a lot of
 * IPC traffic, which should be faster.
 */
function gatherPageInfo(getLinks, maxLinkCount) {
  function isSameishHostname(homepageHostname, otherHostname) {
    if (homepageHostname == otherHostname) {
      return true;
    }
    return otherHostname.endsWith("." + homepageHostname.replace(/^www\./, ""));
  }

  function toURL(url) {
    try {
      url = new URL(url);
    } catch (e) {
      // not actually a valid URL
      return null;
    }
    return url;
  }

  function toURLWithoutHash(url) {
    url = toURL(url);
    if (url) {
      url.hash = "";
    }
    return url;
  }

  function getDataForEmbeddingElement(elem) {
    let url = toURL(elem.localName == "object" ? elem.data : elem.src);
    if (!url) {
      return null;
    }

    let bounds = elem.getBoundingClientRect();

    let data = {
      url: url,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        w: bounds.width,
        h: bounds.height,
      },
    };

    if (getComputedStyle(elem).display == "none") {
      data.isDisplayNone = true;
    }

    if (elem.getTransformToViewport) {
      let m = elem.getTransformToViewport();
      if (!m.isIdentity) {
        data.transform = m.toString().replace(/ /g, "");
      }
    }

    let hasFilter = false, hasClipPath = false, hasMask = false;
    let e = elem;
    do {
      let cs = getComputedStyle(e);
      if (cs.filter != "none") {
        data.hasFilter = true;
      }
      if (cs.mask != "none") {
        data.hasMask = true;
      }
      if (cs.clipPath != "none") {
        data.hasClipPath = true;
      }
    } while ((e = e.parentElement));

    return data;
  }

  function getURLForLink(elem) {
    // We want unique documents, so we ignore any hash in the links
    let url = toURLWithoutHash(elem.href);
    if (!url || (url.protocol != "http:" && url.protocol != "https:")) {
      return ""; // ignore this link
    }
    return url.href;
  }

  function deduplicate(array) {
    return [...new Set(array)]
  }

  const docHostname = document.location.hostname;
  const docURL = document.location.href;

  if (document.readyState == "loading") {
    // If we didn't even reach the "interactive" stage, don't even try to look
    // at the content.
    return JSON.stringify({
      url: docURL,
      loadNotComplete: true,
      subdocs: [],
      links: [],
    });
  }

  const readyState = document.readyState; // stored before we call querySelectorAll

  let subdocsData =
    deduplicate([...document.querySelectorAll("iframe, embed, object")]
                    .map(getDataForEmbeddingElement)
                    .filter(data => data != null));

  let links = [];

  if (getLinks) {
    links =
      deduplicate([...document.links]
                      // only want to crawl site-internal links:
                      .filter(elem => isSameishHostname(docHostname, elem.hostname))
                      .map(getURLForLink)
                      .filter(url => !!url && url != toURLWithoutHash(docURL).href));
    // Limit the number of pages we crawl:
    while (links.length > maxLinkCount) {
      let randomIndex = Math.round(Math.random() * (links.length - 1));
      links.splice(randomIndex, 1); // Remove random link
    }
  }
  
  let result = {
    url: document.location.href,
    subdocs: subdocsData,
    links: links,
  };
  if (readyState != "complete") {
    result.loadNotComplete = true;
  }
  return JSON.stringify(result);
}


let sitesCSVFile = null; // list of sites to crawl
let outputFile = null; // file to output crawl results to
let browser = null;
let processInterupted = false; // user sent SIGINT (^C)


async function cleanup(code) {
  if (browser) {
    // Ensure that we close the WebDriver session otherwise we won't be able
    // to rerun this script without restarting the geckodriver process first:
    await browser.deleteSession();
  }
  if (outputFile) {
    await outputFile.close();
  }
  if (sitesCSVFile) {
    await sitesCSVFile.close();
  }
}


process.once('SIGINT', async (code) => {
  processInterupted = true;

  // Try to make the output JSON valid. This may not work.
  await fsPromises.writeFile(outputFile, `    ]
  }
]
`);

  await cleanup(code);
});


async function createOutputFile() {
  await fsPromises.mkdir(crawlerConfig.outputDirPath, { recursive: true }); // ensure exists

  const dateTime = 
    new Date().toISOString().replace(/T/, '--').replace(/:/g, '-').replace(/\..+/, '');

  return fsPromises.open(crawlerConfig.outputDirPath + "/crawl--" + dateTime + ".json", 'w');
}


async function recreateBrowser() {
  if (browser) {
    try {
      await browser.deleteSession();
    } catch (e) {
      // Ignore "no session" errors
    }
  }
  browser = await remote(browserConfig);
  await browser.setTimeouts(crawlerConfig.scriptTimeout,
                            crawlerConfig.pageTimeout,
                            undefined);
}


async function processPage(pageURL, outputFile, recursionLevelsLeft, isFirstPage = false) {
  if (processInterupted) {
    return; // got SIGINT
  }

  async function writePageJSON(result) {
    const indent = "      ";
    let json = JSON.stringify(result, null, 2).split("\n");
    if (!isFirstPage) {
      json[0] = json[0].replace("{", ",{")
    }
    json[0] = indent + json[0];
    json = json.join("\n" + indent);
    await fsPromises.writeFile(outputFile, json + "\n");
  }

  async function processException(e, pageURL, outputFile, recursionLevelsLeft) {
    if (e.message.indexOf("Timeout loading page after ") != -1) {
      // We just ignore timeouts and continue on to examine the page,
      // even though it's still loading.  (The log output will have
      // "incomplete:" added to the start of the output URL.)
      return "loadNotComplete";
    }

    // Skip this page for any other errors.
    // Browser crashed
    // "Request failed due to insecure certificate"
    // "Reached error page"
    // redirect loops
    // etc.
    let crashed =
      // Browser crashed:
      e.message.indexOf("Tried to run command without establishing a connection") != -1 ||
      // Content process crashed:
      e.message.indexOf("Browsing context has been discarded") != -1;

    if (crashed) {
      let logSummary = crashed ? "skipping crashed page" : "skipping page";
      let recursionLevel = crawlerConfig.recursionDepth - recursionLevelsLeft;
      console.log(`Error: ${logSummary} (level: ${recursionLevel}): ${pageURL} (${e.message})`);
      await recreateBrowser();
      return "crashed";
    }

    return "error";
  }

  let result;
  let loadNotComplete = false;

  try {
    console.log(`Loading page: ${pageURL}`);
    await browser.navigateTo(pageURL);
  } catch(e) {
    let etype = await processException(e, pageURL, outputFile, recursionLevelsLeft);
    if (etype != "loadNotComplete") {
      result = { url: pageURL, subdocs: [] };
      result[etype] = true;
      await writePageJSON(result, outputFile);
      return;
    }
    loadNotComplete = true;
  }

  try {
    result = JSON.parse(await browser.execute(gatherPageInfo, /*getLinks*/ recursionLevelsLeft > 0, crawlerConfig.maxSubPages));
    if (result === null) {
      // XXX Some sort of webdriverio/geckodriver bug where the JSON isn't
      // transferred correctly?!?  But specifically happening on academia.edu.
      throw new Error("null JSON");
    }
  } catch(e) {
    let etype = await processException(e, pageURL, outputFile, recursionLevelsLeft);
    result = { url: pageURL, subdocs: [] };
    result[etype] = true;
    await writePageJSON(result, outputFile);
    return;
  }

  let links = result.links;

  delete result.links;

  await writePageJSON(result, outputFile);

  if (recursionLevelsLeft > 0) {
    for (let linkURL of links) {
      await processPage(linkURL, outputFile, recursionLevelsLeft - 1);
    }
  }
}


async function main() {
  outputFile = await createOutputFile();

  await recreateBrowser();

  sitesCSVFile = readline.createInterface({
    input: fs.createReadStream(crawlerConfig.sitesListFilePath),
    terminal: false,
    crlfDelay: Infinity // allow any line ending types
  });

  await fsPromises.writeFile(outputFile, "[\n");

  let prefix = "";

  for await (let line of sitesCSVFile) {
    let hostname = line.substr(line.indexOf(',') + 1);

    await fsPromises.writeFile(outputFile, `  ${prefix}{
    "hostname": "${hostname}",
    "pages": [
`);

    await processPage("http://" + hostname, outputFile, crawlerConfig.recursionDepth, /* isFirstPage */ true);

    await fsPromises.writeFile(outputFile, `    ]
  }
`);

    prefix = ",";

    // To keep memory use from running away, close the browser and start a new
    // instance:
    await recreateBrowser();
  }

  await fsPromises.writeFile(outputFile, "]\n");
}


main().catch(async (e) => {
  console.error(e);
}).finally(cleanup);

