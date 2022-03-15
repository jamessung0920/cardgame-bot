const fs = require("fs");
const axios = require("axios");
const puppeteer = require("puppeteer");
const sharp = require("sharp");

const config = require("./config");

const speech = require("@google-cloud/speech");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
ffmpeg.setFfmpegPath(ffmpegPath);

// Creates a client
const client = new speech.SpeechClient();
const filename = "/app/audio/demo.m4a";
const formattedFileName = "/app/audio/demo.wav";
const encoding = "LINEAR16";
const sampleRateHertz = 16000;
const languageCode = "zh-TW";

const cardImgDirectory = "/app/downloads";

/** example request body
{
  destination: 'jwioefjiwoefjwioefjewiofjweifoj',
  events: [
    {
      type: 'message',
      message: { type: 'audio', id: '15745701678798', duration: 2876, contentProvider: {type: 'line'}},
      timestamp: 1646469833446,
      source: { type: 'user', userId: 'jwoiefjwioefhwofewhf' },
      replyToken: 'jiowefjoweifwioefjwioefj',
      mode: 'active',
    },
  ],
}
*/
async function handleLineWebhook({ headers, body: reqBody }) {
  const { message, replyToken } = reqBody.events[0];

  if (message.type !== "audio" && message.type !== "text") return;

  if (message.type === "audio") {
    const userContent = await axios.get(
      `https://api-data.line.me/v2/bot/message/${message.id}/content`,
      {
        headers: {
          Authorization: `Bearer ${config.webhook.line.channelAccessToken}`,
          "Content-Type": "application/json",
        },
        responseType: "arraybuffer",
        responseEncoding: "binary",
      }
    );

    fs.writeFile(
      filename,
      userContent.data,
      { encoding: "binary" },
      async function () {
        convertFileFormat(
          filename,
          formattedFileName,
          function (errorMessage) {
            console.log(errorMessage);
          },
          null,
          async function () {
            /**
             * Note that transcription is limited to 60 seconds audio.
             * Use a GCS file for audio longer than 1 minute.
             */
            const audio = {
              content: fs.readFileSync(formattedFileName).toString("base64"),
            };

            const request = {
              config: {
                encoding: encoding,
                sampleRateHertz: sampleRateHertz,
                languageCode: languageCode,
              },
              audio: audio,
            };

            // Detects speech in the audio file. This creates a recognition job that you
            // can wait for now, or get its result later.
            const [operation] = await client.longRunningRecognize(request);

            // Get a Promise representation of the final result of the job
            const [response] = await operation.promise();
            const transcription = response.results
              .map((result) => result.alternatives[0].transcript)
              .join("\n");
            console.log(`Transcription: ${transcription}`);

            const cardNum = transcription
              .replace(" ", "-")
              .replace(/\n/g, "")
              .trim()
              .toUpperCase();
            console.log(cardNum);

            await crawlAndReply(cardNum, replyToken, headers.host);
          }
        );
      }
    );
  } else {
    const cardNum = message.text.trim().toUpperCase();
    await crawlAndReply(cardNum, replyToken, headers.host);
  }
}

async function crawlAndReply(cardNum, replyToken, currentHost) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();

  // page.on("console", (msg) => console.log(msg.text()));

  await page.goto(
    `http://220.134.173.17/gameking/card/ocg_show.asp?call_no=${cardNum}&call_item=1`
  );
  const cardInfo = await page.evaluate(() => {
    const cardInfo = [];
    const elements = document.querySelectorAll("p table tr");
    for (const [idx, row] of elements.entries()) {
      if (idx === 0) continue;
      const columns = row.querySelectorAll("td");
      const cardImg = columns[0].querySelectorAll("img");
      cardInfo.push({
        cardImgUrl: cardImg[0].src,
        effect: columns[1].innerText,
      });
    }
    return cardInfo;
  });

  await browser.close();

  const outputCardImgPath = `${cardImgDirectory}/${cardNum}`;
  await downloadFile(cardInfo[0].cardImgUrl, outputCardImgPath);

  await sharp(outputCardImgPath)
    .extract({ width: 170, height: 250, left: 15, top: 15 })
    .toFile(`${outputCardImgPath}_new`)
    .catch((err) => console.log(err));

  const res = await axios
    .post(
      "https://api.line.me/v2/bot/message/reply",
      {
        replyToken,
        messages: [
          {
            type: "flex",
            altText: "this is a flex message",
            contents: {
              type: "bubble",
              body: {
                type: "box",
                layout: "vertical",
                contents: [
                  {
                    type: "image",
                    url: `https://${currentHost}/static/${cardNum}_new`,
                    size: "full",
                    aspectRatio: "1.91:1.5",
                  },
                  {
                    type: "separator",
                  },
                  {
                    type: "text",
                    text: cardInfo[0].effect,
                    size: "xl",
                    wrap: true,
                  },
                ],
              },
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${config.webhook.line.channelAccessToken}`,
          "Content-Type": "application/json",
        },
      }
    )
    .catch((error) => console.error(error.message));
}

function convertFileFormat(file, destination, error, progressing, finish) {
  ffmpeg(file)
    .on("error", (err) => {
      console.log("An error occurred: " + err.message);
      if (error) {
        error(err.message);
      }
    })
    .on("progress", (progress) => {
      console.log("Processing: " + progress.targetSize + " KB converted");
      if (progressing) {
        progressing(progress.targetSize);
      }
    })
    .on("end", () => {
      console.log("converting format finished !");
      if (finish) {
        finish();
      }
    })
    .save(destination);
}

async function downloadFile(fileUrl, outputLocationPath) {
  const writer = fs.createWriteStream(outputLocationPath);

  return axios({
    method: "get",
    url: fileUrl,
    responseType: "stream",
  }).then((response) => {
    //ensure that the user can call `then()` only when the file has
    //been downloaded entirely.

    return new Promise((resolve, reject) => {
      response.data.pipe(writer);
      let error = null;
      writer.on("error", (err) => {
        error = err;
        writer.close();
        reject(err);
      });
      writer.on("close", () => {
        if (!error) {
          resolve(true);
        }
        //no need to call the reject here, as it will have been called in the
        //'error' stream;
      });
    });
  });
}

module.exports = handleLineWebhook;
