import express from "express";
import axios from "axios";
import OpenAI from "openai";
import fs from "fs";
import morgan from "morgan";
import { generatePaymentLink } from './generatePaymentLink.js';
import winston from 'winston';
import path from 'path';
import dotenv from 'dotenv'; 

// Create a logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: path.join('/app/logs', 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join('/app/logs', 'combined.log') }),
  ],
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}

dotenv.config();
const app = express();
app.use(express.json());

const { WEBHOOK_VERIFY_TOKEN, GRAPH_API_TOKEN, PORT, OPENAI_API_KEY, CUSTOMER_CODE, GTBANK_SECURE_SECRET } =
  process.env;

let sessions = {};
const SESSION_TIMEOUT = 5 * 60 * 1000; // 10 minutes in milliseconds
let business_phone_number_id;

function sanitizeText(text) {
  return text
    .replace(/\\/g, "\\\\") // Escape backslashes
    .replace(/'/g, "\\'") // Escape single quotes
    .replace(/"/g, '\\"'); // Escape double quotes
}

app.post("/webhook", async (req, res) => {
 
  logger.info('Incoming webhook: ' + JSON.stringify(req.body));

  // check if the webhook request contains a message
  const message = req.body.entry?.[0]?.changes[0]?.value?.messages?.[0];
  const contact = req.body.entry?.[0]?.changes[0]?.value?.contacts?.[0];

  // extract the business number to send the reply from it
  business_phone_number_id =
    req.body.entry?.[0].changes?.[0].value?.metadata?.phone_number_id;

  // check if the incoming message contains text
  if (message?.type === "text") {
    // get user phone number
    const userPhoneNumber = contact.wa_id;

    // initialize session if it doesn't exist
    if (!sessions[userPhoneNumber]) {
      sessions[userPhoneNumber] = createNewSession();
    } else {
      // Reset the session timeout
      clearTimeout(sessions[userPhoneNumber].timeout);
      sessions[userPhoneNumber].timeout = setTimeout(() => {
        delete sessions[userPhoneNumber];
        console.log(`Session for ${userPhoneNumber} has expired.`);
      }, SESSION_TIMEOUT);
    }

    // get user message
    const sanitizedMessageBody = sanitizeText(message.text.body);
    // store the last user message in the session
    sessions[userPhoneNumber].lastMessage = sanitizedMessageBody;
    // store the user name in the session
    sessions[userPhoneNumber].session_user_name = contact.profile.name;

    await handleMessage(message, userPhoneNumber);

    // mark incoming message as read
    await axios({
      method: "POST",
      url: `https://graph.facebook.com/v18.0/${business_phone_number_id}/messages`,
      headers: {
        Authorization: `Bearer ${GRAPH_API_TOKEN}`,
      },
      data: {
        messaging_product: "whatsapp",
        status: "read",
        message_id: message.id,
      },
    });

    // Log active sessions
    logActiveSessions();
  } else if (message?.type != "text") {
    // await sendMessage(message,"I can't process this message. Images, Documents, Pictures and files attachments are not supported currently", "🤦‍♂️")
  }
  res.sendStatus(200);
});

function createNewSession() {
  return {
    state: {
      currentService: null,
      flowCompletedStates: [],
      flowNextState: null,
      overallProgress: 0,
    },
    attempts: {
      tvNumber: 0,
      phoneNumber: 0,
      waterNumber: 0,
      meterNumber: 0,
      email: 0,
      prn: 0,
    },
    timeout: setTimeout(() => {
      // This will be overridden when the session is created
    }, SESSION_TIMEOUT),
  };
}

async function sendMessage(message, message_back) {
  await axios({
    method: "POST",
    url: `https://graph.facebook.com/v18.0/${business_phone_number_id}/messages`,
    headers: {
      Authorization: `Bearer ${GRAPH_API_TOKEN}`,
    },
    data: {
      messaging_product: "whatsapp",
      to: message.from,
      text: { body: message_back },
      context: {
        message_id: message.id, // shows the message as a reply to the original user message
      },
    },
  });
  // record response to user
  sessions[message.from].sysResponse = message_back.replace(/\n/g, '');
}

function logActiveSessions() {
  logger.info("Active sessions:");
  for (const [phoneNumber, session] of Object.entries(sessions)) {
    logger.info(
      `User Phone Number: ${phoneNumber}, Current Service: ${session.state.currentService}, User Message: ${session.lastMessage}, Response: ${session.sysResponse}`
    );
  }
}

async function handleMessage(message, userPhoneNumber) {
  const text = message.text.body.toLowerCase();
  const session = sessions[userPhoneNumber];
  let userName = session.session_user_name;

  // const intent = response.data.choices[0].text.trim().toLowerCase();
  const intent = text;

  if (intent.includes("pay") && intent.includes("tv")) {
    await startServiceFlow("tv", message, session, userName);
  } else if (intent.includes("pay") && intent.includes("water")) {
    await startServiceFlow("water", message, session, userName);
  } else if (intent.includes("pay") && (intent.includes("umeme") || intent.includes("yaka"))) {
    await startServiceFlow("umeme", message, session, userName);
  } else if (intent.includes("pay") && (intent.includes("prn") || intent.includes("ura"))) {
    await startServiceFlow("prn", message, session, userName);
  } else if (intent === "restart") {
    await restartFlow(message, session, userName);
  } else if (intent === "services" || intent === "menu") {
    await showServices(message, session, userName);
  } else {
    await processFlowStep(message, session, userName);
  }
}

async function startServiceFlow(service, message, session, userName) {
  session.state.currentService = service;
  session.state.flowCompletedStates = [];
  session.state.flowNextState =
    service === "tv"
      ? "requestTvNumber"
      : service === "water"
      ? "requestWaterNumber"
      : service === "umeme"
      ? "requestMeterNumber"
      : "requestPrn";
  session.state.overallProgress = 0;
  if (service === "tv") {
    await requestTvNumber(message, session, userName);
  } else if (service === "water") {
    await requestWaterNumber(message, session, userName);
  } else if (service === "umeme") {
    await requestMeterNumber(message, session, userName);
  } else if (service === "prn") {
    await requestPrn(message, session, userName);
  } else {
    await showServices(message, session, userName);
  }
}

async function requestTvNumber(message, session, userName) {
  await sendMessage(
    message,
    "To pay for your TV subscription? 📺\n𝗣𝗹𝗲𝗮𝘀𝗲 𝗽𝗿𝗼𝘃𝗶𝗱𝗲 𝘆𝗼𝘂𝗿 𝗧𝗩 𝗻𝘂𝗺𝗯𝗲𝗿.",
    userName
  );
  session.state.flowNextState = "validateTvNumber";
}

async function requestPhoneNumber(message, session, userName) {
  await sendMessage(message, "Great! Now, please enter your mobile money phone number to proceed.", userName);
  session.state.flowNextState = "validatePhoneNumber";
}

async function requestMeterNumber(message, session, userName) {
  await sendMessage(message, "Please enter your meter number.", userName);
  session.state.flowNextState = "validateMeterNumber";
}

async function requestWaterNumber(message, session, userName) {
  await sendMessage(
    message,
    "Please enter your Water account number.",
    userName
  );
  session.state.flowNextState = "validateWaterNumber";
}

async function requestEmail(message, session, userName) {
  await sendMessage(message, "Please enter your email address.", userName);
  session.state.flowNextState = "validateEmail";
}

async function requestPrn(message, session, userName) {
  await sendMessage(message, `✨ Hi ${userName}! To get started with your payment, \n\nCould you please enter your 𝗣𝗥𝗡 (Payment Reference Number)?`, userName);
  session.state.flowNextState = "validatePrn";
}

async function validatePrn(prn, message, session, userName) {
  // Simulate PRN validation
  if (prn === "PRN12345") {
    await sendMessage(
      message,
      `✨ I have found your PRN Details is ${prn}. \n\nPlease send '𝗰𝗼𝗻𝗳𝗶𝗿𝗺' to proceed.`,
      userName
    );
    session.state.flowNextState = "requestPhoneNumber";
    session.attempts.prn = 0; // Reset attempts after successful validation
  } else {
    session.attempts.prn++;
    if (session.attempts.prn < 3) {
      await sendMessage(
        message,
        `Invalid PRN. You have ${
          3 - session.attempts.prn
        } attempts left. Please try again.`,
        userName
      );
    } else {
      await sendMessage(
        message,
        "You have exceeded the maximum number of attempts ⚠. your session has ended.",
        userName
      );
      session.attempts.prn = 0; // Reset attempts after exceeding the limit
      resetState(session);
      await showServices(message, session, userName); // Show the list of services
    }
  }
}

async function validateTvNumber(tvNumber, message, session, userName) {
  // Simulate TV number validation
  if (tvNumber === "12345") {
    await sendMessage(
      message,
      `Your TV number is ${tvNumber}. Please send 'confirm' to proceed.`,
      userName
    );
    session.state.flowNextState = "requestPhoneNumber";
    session.attempts.tvNumber = 0; // Reset attempts after successful validation
  } else {
    session.attempts.tvNumber++;
    if (session.attempts.tvNumber < 3) {
      await sendMessage(
        message,
        `Invalid TV number. You have ${
          3 - session.attempts.tvNumber
        } attempts left. Please try again.`,
        userName
      );
    } else {
      await sendMessage(
        message,
        "You have exceeded the maximum number of attempts. your session has ended.",
        userName
      );
      session.attempts.tvNumber = 0; // Reset attempts after exceeding the limit
      resetState(session);
      await showServices(message, session, userName); // Show the list of services
    }
  }
}

async function validatePhoneNumber(phoneNumber, message, session, userName) {
  // Simulate phone number validation
  if (phoneNumber === "9876543210") {
    
    // await sendMessage(
    //   message,
    //   `✨ Thank you! ${userName}, I have sent a payment prompt to your phone number: Please Authorize Payment to complete the transaction`,
    //   userName
    // );
    
    const m_service = session.state.currentService;
    const cleaned_name = replaceSpacesWithHyphens(userName);
    const cleaned_details = replaceSpacesWithHyphens(`Service Payment for ${m_service}`);
    const amount = 500;
    const currency = 'UGX';
    const customerCode = CUSTOMER_CODE;
    const orderId = generateOrderId();
    const payerName = cleaned_name;
    const transDetails = cleaned_details;
    const transDate = getCurrentDate();
    const emailAddress = 'john@gmail.com';
    const secureSecret = GTBANK_SECURE_SECRET;

    const paymentLink = generatePaymentLink(amount, currency, customerCode, orderId, payerName, transDetails, transDate, emailAddress, secureSecret);
   

    await sendMessage(
      message,
      `Thank you! ${userName}, Here is the payment link \n\n ${paymentLink} \n\n click on the link to complete the Payment for ${session.state.currentService}`,
      userName
    );
    session.state.flowNextState = null;
    session.state.overallProgress = 100;
    session.attempts.phoneNumber = 0; // Reset attempts after successful validation
  } else {
    session.attempts.phoneNumber++;
    if (session.attempts.phoneNumber < 3) {
      await sendMessage(
        message,
        `Invalid phone number. You have ${
          3 - session.attempts.phoneNumber
        } attempts left. Please try again.`,
        userName
      );
    } else {
      await sendMessage(
        message,
        "You have exceeded the maximum number of attempts. your session has ended",
        userName
      );
      session.attempts.phoneNumber = 0; // Reset attempts after exceeding the limit
      resetState(session);
      await showServices(message, session, userName); // Show the list of services
    }
  }
}

async function validateWaterNumber(waterNumber, message, session, userName) {
  // Simulate Water account number validation
  if (waterNumber === "67890") {
    await sendMessage(
      message,
      `Your Water account number is ${waterNumber}. Please send 'confirm' to proceed.`,
      userName
    );
    session.state.flowNextState = "requestEmail";
    session.attempts.waterNumber = 0; // Reset attempts after successful validation
  } else {
    session.attempts.waterNumber++;
    if (session.attempts.waterNumber < 3) {
      await sendMessage(
        message,
        `Invalid Water account number. You have ${
          3 - session.attempts.waterNumber
        } attempts left. Please try again.`,
        userName
      );
    } else {
      await sendMessage(
        message,
        "You have exceeded the maximum number of attempts. Try again",
        userName
      );
      session.attempts.waterNumber = 0; // Reset attempts after exceeding the limit
      resetState(session);
      await showServices(message, session, userName); // Show the list of services
    }
  }
}

async function validateMeterNumber(meterNumber, message, session, userName) {
  // Simulate meter number validation
  if (meterNumber === "54321") {
    await sendMessage(
      message,
      `Your meter number is ${meterNumber}. Please type 'confirm' to proceed.`,
      userName
    );
    session.state.flowNextState = "requestPhoneNumber";
    session.attempts.meterNumber = 0; // Reset attempts after successful validation
  } else {
    session.attempts.meterNumber++;
    if (session.attempts.meterNumber < 3) {
      await sendMessage(
        message,
        `Invalid meter number. You have ${
          3 - session.attempts.meterNumber
        } attempts left. Please try again.`,
        userName
      );
    } else {
      await sendMessage(
        message,
        "You have exceeded the maximum number of attempts. your session has ended",
        userName
      );
      session.attempts.meterNumber = 0; // Reset attempts after exceeding the limit
      resetState(session);
      await showServices(message, session, userName); // Show the list of services
    }
  }
}

async function validateEmail(email, message, session, userName) {
  // Simulate email validation
  if (email === "user@example.com") {
    await sendMessage(
      message,
      "Here is your payment link: [Payment Link]",
      userName
    );
    session.state.flowNextState = null;
    session.state.overallProgress = 100;
    session.attempts.email = 0; // Reset attempts after successful validation
  } else {
    session.attempts.email++;
    if (session.attempts.email < 3) {
      await sendMessage(
        message,
        `Invalid email address. You have ${
          3 - session.attempts.email
        } attempts left. Please try again.`,
        userName
      );
    } else {
      await sendMessage(
        message,
        "You have exceeded the maximum number of attempts. your session has ended",
        userName
      );
      session.attempts.email = 0; // Reset attempts after exceeding the limit
      resetState(session);
      await showServices(message, session, userName); // Show the list of services
    }
  }
}

function replaceSpacesWithHyphens(input) {
    return input.replace(/ /g, '-');
}

function getCurrentDate() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    const seconds = String(now.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}-${minutes}-${seconds}Z`;
}

function generateOrderId() {
    return Math.random().toString(36).substr(2, 9);
}

function resetState(session) {
  session.state.currentService = null;
  session.state.flowCompletedStates = [];
  session.state.flowNextState = null;
  session.state.overallProgress = 0;
}

async function restartFlow(message, session, userName) {
  await startServiceFlow(
    session.state.currentService,
    message,
    session,
    userName
  );
}

async function showServices(message, session, userName) {
  resetState(session);
  await sendMessage(
    message,
    `Hey ${userName}! 🤭 I can help you pay for these services using mobile money:\n\n \u2022 URA (PRN) 🔢\n \u2022 National Water (NWSC) 💦\n \u2022 Electricity (UMEME/YAKA) ⚡\n \u2022 TV (GOTV & DSTV) 📺\n\n𝗥𝗲𝗽𝗹𝘆 𝘄𝗶𝘁𝗵 𝗣𝗮𝘆 𝗣𝗥𝗡 , 𝗼𝗿 𝗣𝗮𝘆 𝗨𝗠𝗘𝗠𝗘 , 𝗼𝗿 𝗣𝗮𝘆 𝗪𝗮𝘁𝗲𝗿 , 𝗼𝗿 𝗣𝗮𝘆 𝗧𝘃. \n\nLet's make things easy for you! 😎`,
    userName
  );
}

async function processFlowStep(message, session, userName) {
  const text = message.text.body;
  if (session.state.flowNextState === "validateTvNumber") {
    await validateTvNumber(text, message, session, userName);
  } else if (session.state.flowNextState === "requestPhoneNumber") {
    if (text.toLowerCase() === "confirm") {
      await requestPhoneNumber(message, session, userName);
    } else {
      await sendMessage(message, "Please send 'confirm' to proceed.", userName);
    }
  } else if (session.state.flowNextState === "validatePhoneNumber") {
    await validatePhoneNumber(text, message, session, userName);
  } else if (session.state.flowNextState === "validateWaterNumber") {
    await validateWaterNumber(text, message, session, userName);
  } else if (session.state.flowNextState === "requestEmail") {
    if (text.toLowerCase() === "confirm") {
      await requestEmail(message, session, userName);
    } else {
      await sendMessage(message, "Please send 'confirm' to proceed.", userName);
    }
  } else if (session.state.flowNextState === "validateEmail") {
    await validateEmail(text, message, session, userName);
  } else if (session.state.flowNextState === "validateMeterNumber") {
    await validateMeterNumber(text, message, session, userName);
  } else if (session.state.flowNextState === "validatePrn") {
    await validatePrn(text, message, session, userName);
  } else {
    await showServices(message, session, userName);
  }
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  // check the mode and token sent are correct
  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    // respond with 200 OK and challenge token from the request
    res.status(200).send(challenge);
    logger.info("Webhook verified successfully!");
  } else {
    // respond with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
  }
});

app.get("/", (req, res) => {
  res.send(`<pre>GTbank Whatsapp API</pre>`);
});

app.listen(PORT, () => {
  console.log(`Server is listening on port: ${PORT}`);
});
