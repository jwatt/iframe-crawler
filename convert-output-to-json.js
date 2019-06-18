/**
 * Expects the first argument to be the path of a crawl output file, or else
 * defaults to using 'output/crawl.txt'.  Outputs the JSON to stdout (redirect
 * it to a file as appropriate).
 */

"use strict";

const fs = require('fs');
const process = require('process');
const readline = require('readline');

const inputFilePath = process.argv[2] || "output/crawl.txt";

const inputFile = readline.createInterface({
  input: fs.createReadStream(inputFilePath),
  terminal: false,
  crlfDelay: Infinity // allow any line ending types
});

function isSameOrigin(pageURL, subdocURL) {
  try {
    if (subdocURL == "about:blank" || subdocURL.startsWith("javascript:")) {
      return true;
    }
    pageURL = new URL(pageURL);
    subdocURL = new URL(subdocURL);
    return pageURL.origin == subdocURL.origin;
  } catch(e) {
    // Broken URLs aren't interesting; don't add them to the cross-origin list.
    return true;
  }
}

const boundsRE = /bounds\(([^,]+),([^,]+),([^,]+),([^,]+)\)/;

async function main() {
  let sites = [];
  let currentSite = { hostname: "" };
  let currentPage;

  for await (let line of inputFile) {
    // Check for start of new site:
    if (line.startsWith("site:")) {
      let host = line.substr(5);
      currentSite = {
	hostname: host,
	url: "http://" + host + "/",
	pages: [],
	skipCounts: { timeout: 0, crashed: 0, error: 0 },
      };
      sites.push(currentSite);
      continue;
    }

    // Check for page load:
    if (line[0] != " ") {
      let prefix = line.substring(0, line.indexOf(":"));
      if (prefix == "skipping-timeout" ||
	  prefix == "skipping-crashed" ||
	  prefix == "skipping-error" ||
	  prefix == "incomplete") {
	line = line.substr(line.indexOf(":") + 1);
      } else {
	prefix = "";
      }
      let url = new URL(line);
      currentPage = {
	url: line,
	subdocs: [],
      };
      if (prefix) {
	let skipError = prefix.substr(prefix.indexOf("-") + 1); // handles 'incomplete' too :p
	currentSite.skipCounts[skipError] += 1;
	currentPage[skipError] = true;
      }
      currentSite.pages.push(currentPage);
      continue;
    }

    // Otherwise, this is data for a subdoc embedded in the last page

    let subdocData = {
      url: line.substring(line.indexOf("|") + 1),
    };
    subdocData.sameOrigin = isSameOrigin(currentPage.url, subdocData.url);

    let props = line.substring(0, line.indexOf("|")).trimLeft().split(";");
    for (let prop of props) {
      let bounds = boundsRE.exec(prop);
      if (bounds) {
        bounds.shift();
	let [x, y, w, h] = bounds;
	subdocData.bounds = { x:x, y:y, w:w, h:h };
	continue;
      }
      if (prop.startsWith("matrix(")) {
        subdocData.transform = prop;
	continue;
      }
      if (prop == "hidden-by-display") {
	subdocData.isDisplayNone = true;
	continue;
      }
      subdocData[prop] = true;
    }

    currentPage.subdocs.push(subdocData);
  }

  const json = JSON.stringify({sites: sites}, null, 2);
  process.stdout.write(json);
}


main().finally(async (e) => {
  inputFile.close();
});

