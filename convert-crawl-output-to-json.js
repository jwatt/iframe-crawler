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

function isSameOrigin(url1, url2) {
  try {
    url1 = new URL(url1);
    url2 = new URL(url2);
    return url1.origin == url2.origin;
  } catch(e) {
    // Broken URLs aren't interesting; don't add them to the cross-origin list.
    return true;
  }
}

async function main() {
  let sites = [];
  let currentSite = { hostname: "" };
  let currentPage;

  for await (let line of inputFile) {
    let prefix = line.substring(0, line.indexOf(":"));

    if (line[0] != " ") {
      if (prefix == "site") {
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
	subdocs: {
	  visibleCrossOrigin: [],
	  visibleSameOrigin: [],
	  hiddenBySize: [],
	  hiddenByDisplay: [],
	},
      };
      if (prefix) {
	let skipError = prefix.substr(prefix.indexOf("-") + 1);
	currentSite.skipCounts[skipError] += 1;
	currentPage[skipError] = true;
      }
      currentSite.pages.push(currentPage);
    } else {
      // subdoc URLs
      if (prefix == "  hidden-by-display") {
	currentPage.subdocs.hiddenByDisplay.push(line.substr(line.indexOf(":") + 1));
      } else if (prefix == "  hidden-by-size") {
	currentPage.subdocs.hiddenBySize.push(line.substr(line.indexOf(":") + 1));
      } else {
	line = line.substr(2);
	if (line == "about:blank" ||
	    line.startsWith("javascript:") ||
	    isSameOrigin(currentPage.url, line)) {
	  currentPage.subdocs.visibleSameOrigin.push(line);
	} else {
	  currentPage.subdocs.visibleCrossOrigin.push(line);
	}
      }
    }
  }

  const json = JSON.stringify({sites: sites}, null, 2);
  process.stdout.write(json);
}


main().finally(async (e) => {
  inputFile.close();
});

