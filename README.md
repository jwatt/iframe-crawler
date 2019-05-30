
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


Setup on Ubuntu 19.04
=====================

# Install up-to-date node.js and npm (Ubuntu installs the LTS version by default).
# Using instructions from:
# https://github.com/nodesource/distributions/blob/master/README.md#installation-instructions
curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install webdriverio:
npm install webdriverio

# Get geckodriver:
curl -L https://github.com/mozilla/geckodriver/releases/download/v0.24.0/geckodriver-v0.24.0-linux64.tar.gz | tar xz

# Optionally, update the Alexa and/or Cisco top one million lists:
curl -L https://s3.amazonaws.com/alexa-static/top-1m.csv.zip | funzip > alexa-top-1m.csv
curl -L https://s3-us-west-1.amazonaws.com/umbrella-static/top-1m.csv.zip | funzip > cisco-top-1m.csv

# Optionally, create a reduced list:
head -1000 alexa-top-1m.csv > alexa-top-1k.csv
head -1000 cisco-top-1m.csv > cisco-top-1k.csv


Running
=======

# Run geckodriver in one Terminal tab (it acts as an intermediary between webdriverio and Firefox):
./geckodriver --port 4444

# Run the crawler in another tab:
node crawl-for-iframes.js alexa-top-1k.csv






Previously:

When installing node.js on Ubuntu 19.04 via `apt install` I ended up with node 10, not node 12 as on macOS.
I had to install using the Ubuntu Software GUI app, changing the "Channel" field to the more recent "12/stable".
That left me with two `node` binaries in my PATH, but the older one first.

$ which -a node
/usr/bin/node
/bin/node
/snap/bin/node

Similar for npm.

Hence the paths used below:



Wireguard on IVPN
-----------------

Setup:
https://www.ivpn.net/setup/gnu-linux-wireguard.html

Connect:
sudo wg-quick up us-tx1

Check external IP:
curl ifconfig.co

Disconnect:
sudo wg-quick down us-tx1


Virtualbox
----------

Installed via Ubuntu Software GUI app.

Was only given the choice to create 32-bit guests. Help on:
https://forums.virtualbox.org/viewtopic.php?f=1&t=62339

Processor i9-7940X does have VT-x support.





