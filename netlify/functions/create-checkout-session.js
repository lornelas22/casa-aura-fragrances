exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const cart = JSON.parse(event.body || "[]");

    if (!Array.isArray(cart) || cart.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Your cart is empty." })
      };
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
      throw new Error("STRIPE_SECRET_KEY is not configured.");
    }

    const supabaseUrl = "https://tmxpuurukwgeckpgfdhm.supabase.co";
    const supabaseKey =
      "sb_publishable_pyRgGZxtK_Hbi5DirVLLiA_IkxXdHq_";

    const lineItems = [];

    for (const item of cart) {
      const productId = String(item.productId || "");
      const sizeMl = Number(item.sizeMl);
      const quantity = Number(item.quantity);

      if (!productId || !Number.isInteger(sizeMl) || !Number.isInteger(quantity)) {
        throw new Error("Invalid cart item.");
      }

      if (quantity < 1 || quantity > 20) {
        throw new Error("Invalid quantity.");
      }

      // Get the published product from Supabase.
      const productResponse = await fetch(
        `${supabaseUrl}/rest/v1/products?id=eq.${encodeURIComponent(
          productId
        )}&published=eq.true&select=id,brand,name,image_url`
        ,
        {
          headers: {
            apikey: supabaseKey,
          }
        }
      );

      if (!productResponse.ok) {
  const errorText = await productResponse.text();
  throw new Error(
    `Supabase product check failed (${productResponse.status}): ${errorText}`
  );
}

      const products = await productResponse.json();

      if (!products.length) {
        throw new Error("One of the products is no longer available.");
      }

      const product = products[0];

      // Get the selected size, price and inventory from Supabase.
      const sizeResponse = await fetch(
        `${supabaseUrl}/rest/v1/product_sizes?product_id=eq.${encodeURIComponent(
          productId
        )}&size_ml=eq.${encodeURIComponent(
          sizeMl
        )}&select=size_ml,price,inventory`,
        {
          headers: {
            apikey: supabaseKey,
          }
        }
      );

      if (!sizeResponse.ok) {
        throw new Error("Unable to verify product size.");
      }

      const sizes = await sizeResponse.json();

      if (!sizes.length) {
        throw new Error("The selected size is no longer available.");
      }

      const size = sizes[0];
      const price = Number(size.price);
      const inventory = Number(size.inventory);

      if (!Number.isFinite(price) || price < 0) {
        throw new Error("Invalid product price.");
      }

      if (inventory < quantity) {
        throw new Error(
          `${product.brand} ${product.name} (${sizeMl}mL) does not have enough inventory.`
        );
      }

      const priceData = {
        currency: "usd",
        unit_amount: Math.round(price * 100),
        product_data: {
          name: `${product.brand} ${product.name} — ${sizeMl}mL`
        }
      };

      if (product.image_url) {
        priceData.product_data.images = [product.image_url];
      }

      lineItems.push({
        price_data: priceData,
        quantity: quantity
      });
    }

    const params = new URLSearchParams();

    params.append("mode", "payment");

    params.append(
      "success_url",
      "https://casa-aura-fragrances.netlify.app/cart.html?success=1"
    );

    params.append(
      "cancel_url",
      "https://casa-aura-fragrances.netlify.app/cart.html"
    );

    lineItems.forEach((item, index) => {
      params.append(
        `line_items[${index}][price_data][currency]`,
        item.price_data.currency
      );

      params.append(
        `line_items[${index}][price_data][unit_amount]`,
        String(item.price_data.unit_amount)
      );

      params.append(
        `line_items[${index}][price_data][product_data][name]`,
        item.price_data.product_data.name
      );

      if (item.price_data.product_data.images) {
        params.append(
          `line_items[${index}][price_data][product_data][images][0]`,
          item.price_data.product_data.images[0]
        );
      }

      params.append(
        `line_items[${index}][quantity]`,
        String(item.quantity)
      );
    });

    params.append("billing_address_collection", "auto");
    params.append("shipping_address_collection[allowed_countries][0]", "US");

    const stripeResponse = await fetch(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params.toString()
      }
    );

    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error("Stripe error:", session);

      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: session.error?.message || "Unable to create checkout."
        })
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url: session.url
      })
    };
  } catch (error) {
    console.error("Checkout error:", error);

    return {
      statusCode: 400,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: error.message || "Unable to start checkout."
      })
    };
  }
};
