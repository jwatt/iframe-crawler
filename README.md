
Introduction
============

This is quick-and-dirty Web crawler used to crawl a given list of sites looking for pages that
use iframes.  The list of sites is specified on the command line to the crawler script (see
below).  The crawler is based on webdriver.io, which is a node.js app.

Varies parts of the behavior are currently hardcoded in a `config` object at the top of the
script.  For example, the crawler will only crawl pages linked from the main page of each
website, and is limited to crawling a maximum of 100 pages per site.

Other parts of the behavior are handcoded in the script itself.  For example, the results of
the crawl are output to a subdirectory called `output` to a file with a timestamped based name.

Additional limitations of note:

 - Only examines the top-level document's content (we could potentially examine
   subdocuments using `browser.switchToFrame(id)`).

The output format is a list of URLs.  The URL of the page that is under examination is output
first, and if any subdocument embedding elements with a valid URL are found their URLs are
output next, all indented by two spaces.  URLs may optionally be prefixed by an additional
"scheme". For example, "skipped:<URL>" indicates a page that was skipped due to some sort of
error being encountered.


Setup
=====

Install an up-to-date node.js and npm, probably using a [package manager](https://nodejs.org/en/download/package-manager/).

For example, the [NodeSource instructions](https://github.com/nodesource/distributions/blob/master/README.md#installation-instructions)
for Ubuntu:
```
curl -sL https://deb.nodesource.com/setup_13.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Install webdriverio:
```
npm install webdriverio
```

Get geckodriver:
```
curl -L https://github.com/mozilla/geckodriver/releases/download/v0.26.0/geckodriver-v0.26.0-linux64.tar.gz | tar xz
```

Optionally, update the Alexa and/or Cisco top one million lists:
```
curl -L https://s3.amazonaws.com/alexa-static/top-1m.csv.zip | funzip > alexa-top-1m.csv
curl -L https://s3-us-west-1.amazonaws.com/umbrella-static/top-1m.csv.zip | funzip > cisco-top-1m.csv
```

Optionally, create reduced list:
```
head -1000 alexa-top-1m.csv > alexa-top-1k.csv
head -1000 cisco-top-1m.csv > cisco-top-1k.csv
```

Optionally, get and use a specific version of firefox:
```
curl -L https://ftp.mozilla.org/pub/firefox/nightly/latest-mozilla-central/firefox-69.0a1.en-US.linux-x86_64.tar.bz2 | tar jx
export IFRAME_CRAWLER_FIREFOX_BIN="$PWD/firefox/firefox"
```


Running
=======

Run geckodriver in one shell (geckodriver acts as an intermediary
between webdriverio and Firefox):
```
./geckodriver --port 4444
```

Run the crawler in another shell:
```
node crawl-for-iframes.js alexa-top-1k.csv
```


Postprocessing
==============

The date-stamped .txt files in the output directory can be processed using the
`convert-output-to-json.js` node.js script to create a JSON results file:
```
node convert-output-to-json.js output/crawl.txt > output/crawl.json
```


Displaying
==========

The file `display-crawl-results.html` is a simple HTML viewer for the
output/crawl.json file.


Raw output file
===============

The raw output file from a crawl contains a series of 'site' blocks that look
like this:

```
site:<hostname>
<page-prefix><page-url>
  <subdoc-prefix><subdoc-url>
```

The 'site:' line denotes the start of the crawl output for a new site
(as found in the input .csv file).

A 'site:' line is followed by one or more 'page-url' lines, which are each
followed by zero or more 'subdoc-url' lines that are indented by two spaces to
denote that they the URLs of subdocuments embedded by the page above.

