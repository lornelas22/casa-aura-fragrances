const crypto = require("crypto");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "Method not allowed"
      })
    };
  }

  try {
    const liveStripeSecretKey = process.env.STRIPE_SECRET_KEY;
const testStripeSecretKey = process.env.STRIPE_TEST_SECRET_KEY;
const liveWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const testWebhookSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

if (!liveStripeSecretKey) {
  throw new Error("STRIPE_SECRET_KEY is not configured.");
}

if (!testStripeSecretKey) {
  throw new Error("STRIPE_TEST_SECRET_KEY is not configured.");
}

if (!liveWebhookSecret) {
  throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
}

if (!testWebhookSecret) {
  throw new Error("STRIPE_TEST_WEBHOOK_SECRET is not configured.");
}

if (!supabaseSecretKey) {
  throw new Error("SUPABASE_SECRET_KEY is not configured.");
}

    const signature = event.headers["stripe-signature"];

    if (!signature) {
      return {
        statusCode: 400,
        body: "Missing Stripe signature."
      };
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body || "";

    const elements = signature.split(",");

const timestampElement = elements.find((item) =>
  item.startsWith("t=")
);

const signatureElements = elements
  .filter((item) => item.startsWith("v1="))
  .map((item) => item.substring(3));

if (!timestampElement || signatureElements.length === 0) {
  return {
    statusCode: 400,
    body: "Invalid Stripe signature."
  };
}

const timestamp = Number(timestampElement.substring(2));

if (!Number.isInteger(timestamp)) {
  return {
    statusCode: 400,
    body: "Invalid Stripe timestamp."
  };
}

const timestampAge = Math.abs(
  Math.floor(Date.now() / 1000) - timestamp
);

if (timestampAge > 300) {
  return {
    statusCode: 400,
    body: "Expired Stripe signature."
  };
}

const signedPayload = `${timestamp}.${rawBody}`;

const expectedLiveSignature = crypto
  .createHmac("sha256", liveWebhookSecret)
  .update(signedPayload, "utf8")
  .digest("hex");

const expectedTestSignature = crypto
  .createHmac("sha256", testWebhookSecret)
  .update(signedPayload, "utf8")
  .digest("hex");

const signaturesMatchLive = signatureElements.some(
  (receivedSignature) =>
    receivedSignature.length === expectedLiveSignature.length &&
    crypto.timingSafeEqual(
      Buffer.from(expectedLiveSignature, "utf8"),
      Buffer.from(receivedSignature, "utf8")
    )
);

const signaturesMatchTest = signatureElements.some(
  (receivedSignature) =>
    receivedSignature.length === expectedTestSignature.length &&
    crypto.timingSafeEqual(
      Buffer.from(expectedTestSignature, "utf8"),
      Buffer.from(receivedSignature, "utf8")
    )
);

if (!signaturesMatchLive && !signaturesMatchTest) {
  return {
    statusCode: 400,
    body: "Invalid Stripe signature."
  };
}

const stripeEvent = JSON.parse(rawBody);

const stripeSecretKey = stripeEvent.livemode
  ? liveStripeSecretKey
  : testStripeSecretKey;
      };
  };

    if (stripeEvent.type !== "checkout.session.completed") {
      return {
        statusCode: 200,
        body: JSON.stringify({
          received: true
        })
      };
    }

    const session = stripeEvent.data.object;

    if (session.payment_status !== "paid") {
      return {
        statusCode: 200,
        body: JSON.stringify({
          received: true
        })
      };
    }

    const lineItemsResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(
        session.id
      )}/line_items?limit=100&expand[]=data.price.product`,
      {
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`
        }
      }
    );

    if (!lineItemsResponse.ok) {
      const errorText = await lineItemsResponse.text();
      throw new Error(
        `Unable to retrieve Stripe line items: ${errorText}`
      );
    }

    const lineItemsData = await lineItemsResponse.json();

    const items = [];

    for (const lineItem of lineItemsData.data || []) {
      const product = lineItem.price?.product;

      if (!product || typeof product !== "object") {
        throw new Error("Stripe product information is missing.");
      }

      const productId = product.metadata?.product_id;
      const sizeMl = Number(product.metadata?.size_ml);
      const quantity = Number(lineItem.quantity);

      if (
        !productId ||
        !Number.isInteger(sizeMl) ||
        !Number.isInteger(quantity) ||
        quantity < 1
      ) {
        throw new Error("Invalid Stripe product metadata.");
      }

      const unitAmount = Number(lineItem.price?.unit_amount);

      if (!Number.isFinite(unitAmount)) {
        throw new Error("Invalid Stripe price.");
      }

      items.push({
        product_id: productId,
        size_ml: sizeMl,
        quantity: quantity
      });
    }

    if (items.length === 0) {
      throw new Error("No items found in Stripe checkout session.");
    }

    const customerEmail =
      session.customer_details?.email ||
      session.customer_email ||
      null;

    const totalAmount = Number(session.amount_total || 0) / 100;

    const shippingAddress =
      session.shipping_details?.address || null;

    const supabaseResponse = await fetch(
      "https://tmxpuurukwgeckpgfdhm.supabase.co/rest/v1/rpc/process_stripe_order",
      {
        method: "POST",
        headers: {
          apikey: supabaseSecretKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_stripe_session_id: session.id,
          p_customer_email: customerEmail,
          p_total_amount: totalAmount,
          p_shipping_address: shippingAddress,
          p_items: items
        })
      }
    );

    if (!supabaseResponse.ok) {
      const errorText = await supabaseResponse.text();
      throw new Error(
        `Unable to process Supabase order: ${errorText}`
      );
    }

    const orderId = await supabaseResponse.json();

    console.log(
      "Order processed successfully:",
      session.id,
      orderId
    );

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        received: true,
        order_id: orderId
      })
    };
  } catch (error) {
    console.error("Stripe webhook error:", error);

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: error.message || "Webhook processing failed."
      })
    };
  }
};
