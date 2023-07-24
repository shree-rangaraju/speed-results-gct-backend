const express = require("express");
const multer = require("multer");
const fs = require("fs");
const puppeteer = require("puppeteer");
const archiver = require("archiver");
const util = require("util");
const path = require("path");
const cors = require("cors");

const app = express();
const port = 4000;
const upload = multer({ dest: "uploads/" });

app.use("/uploads", express.static("uploads"));
app.use(cors());

const readFileAsync = util.promisify(fs.readFile);

app.post("/upload", upload.single("rollNumbers"), async (req, res) => {
  const { path } = req.file;

  try {
    const rollNumbersData = await readFileAsync(path, "utf8");
    const rollNumberArray = rollNumbersData
      .split(/\r?\n/)
      .filter((num) => num.trim() !== "");
    const base_url = "https://gct.ac.in/results";
    const folderPath = `./results/${Date.now()}`;

    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    await get_results(rollNumberArray, base_url, folderPath);
    const zipFileName = `${folderPath}.zip`;

    await createAndSendZip(res, folderPath, zipFileName);

    fs.promises.unlink(zipFileName);
    fs.promises.rm(folderPath, { recursive: true });
    fs.promises.unlink(path);
  } catch (error) {
    console.error("Error processing uploaded file:", error);
    res.status(500).json({ error: "Error processing uploaded file." });
  }
});

async function get_results(roll_number_data, base_url, folderPath) {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  try {
    await page.goto(base_url);
    await page.waitForSelector("td input.form-text");

    for (const roll_number of roll_number_data) {
      try {
        await page.type("td input.form-text", roll_number.toString());
        await Promise.all([
          page.click(".btn"),
          page.waitForNavigation({ waitUntil: "networkidle0" }),
        ]);

        await page.screenshot({
          path: path.join(folderPath, `resultOf_${roll_number}.png`),
          fullPage: true,
        });
        console.log(`Result downloaded for roll number: ${roll_number}`);
      } catch (error) {
        console.error(
          `Error downloading result for roll number: ${roll_number}`
        );
        console.error(error);
      }

      await page.$eval("td input.form-text", (input) => (input.value = ""));
    }
  } catch (error) {
    console.error("Error occurred during page navigation:", error);
  } finally {
    await browser.close();
  }
}

async function createAndSendZip(res, sourceFolder, zipFileName) {
  const output = fs.createWriteStream(zipFileName);
  const archive = archiver("zip", { zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on("close", () => {
      res.set("Content-Type", "application/zip");
      res.set(
        "Content-Disposition",
        `attachment; filename=${path.basename(zipFileName)}`
      );

      const fileStream = fs.createReadStream(zipFileName);
      fileStream.on("error", (error) => {
        console.error("Error sending zip file:", error);
        res.status(500).end();
      });

      fileStream.pipe(res);
      resolve();
    });

    archive.on("error", reject);
    archive.pipe(output);
    archive.directory(sourceFolder, false);

    archive.finalize();
  });
}

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
