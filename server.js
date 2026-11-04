
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(express.json());

app.use(cors({
  origin: process.env.FRONTEND_URL || true
}));

const PORT = process.env.PORT || 3000;

const OPTIMA_BASE =
  "https://optimapaybridge.co.ke/api/v2";

const API_KEY = process.env.OPTIMA_API_KEY;
const API_SECRET = process.env.OPTIMA_API_SECRET;
const ACCOUNT_ID = Number(
  process.env.OPTIMA_PAYMENT_ACCOUNT_ID
);

// OptimaPay request helper
async function optimaRequest(endpoint, payload) {
  const response = await fetch(
    `${OPTIMA_BASE}/${endpoint}`,
    {
      method: "POST",
      headers: {
        "X-API-Key": API_KEY,
        "X-API-Secret": API_SECRET,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    }
  );

  const data = await response.json();

  if (!response.ok || data.success !== true) {
    throw new Error(
      data.message || "OptimaPay request failed"
    );
  }

  return data;
}

// Server health
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "OptimaPay Merchant Backend Online",
    provider: "OptimaPay"
  });
});

// Initiate merchant STK Push
app.post("/api/pay", async (req, res) => {
  try {
    if (
      !API_KEY ||
      !API_SECRET ||
      !Number.isInteger(ACCOUNT_ID) ||
      ACCOUNT_ID < 1
    ) {
      return res.status(500).json({
        success: false,
        message: "Payment credentials are not configured."
      });
    }

    let { phone, amount, description } = req.body;

    if (!phone || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: "Phone and amount are required."
      });
    }

    phone = String(phone).replace(/\s+/g, "");

    if (phone.startsWith("+")) {
      phone = phone.substring(1);
    }

    if (phone.startsWith("0")) {
      phone = "254" + phone.substring(1);
    }

    if (!/^254[17]\d{8}$/.test(phone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Kenyan M-Pesa number."
      });
    }

    amount = Number(amount);

    if (
      !Number.isFinite(amount) ||
      amount < 1 ||
      amount > 1000000
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount."
      });
    }

    const reference =
      "ORDER_" +
      crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    const payment = await optimaRequest(
      "stkpush.php",
      {
        payment_account_id: ACCOUNT_ID,
        phone,
        amount,
        reference,
        description: String(
          description || "Website purchase"
        ).slice(0, 100)
      }
    );

    res.json({
      success: true,
      message: payment.message,
      reference,
      checkout_request_id:
        payment.checkout_request_id,
      merchant_request_id:
        payment.merchant_request_id
    });

  } catch (error) {
    console.error("PAYMENT ERROR:", error.message);

    res.status(502).json({
      success: false,
      message: error.message
    });
  }
});

// Check payment status
app.post("/api/status", async (req, res) => {
  try {
    const { checkout_request_id } = req.body;

    if (
      typeof checkout_request_id !== "string" ||
      checkout_request_id.length < 5 ||
      checkout_request_id.length > 150
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid Checkout Request ID."
      });
    }

    const result = await optimaRequest(
      "status.php",
      { checkout_request_id }
    );

    res.json({
      success: true,
      status: result.status,
      amount: result.amount,
      phone: result.phone,
      transaction_code: result.transaction_code,
      created_at: result.created_at
    });

  } catch (error) {
    console.error("STATUS ERROR:", error.message);

    res.status(502).json({
      success: false,
      message: error.message
    });
  }
});

// Unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found."
  });
});

app.listen(PORT, () => {
  console.log(
    `OptimaPay backend running on port ${PORT}`
  );
});
