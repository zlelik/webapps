let isDebug = true;
let processor = null;
let model = null;
let generateBtnEl = document.getElementById("gen_btn");
let generateAppendBtnEl = document.getElementById("gen_add_btn");
window.addEventListener('load', async function() {
  logMsg("window loaded");
  if (window.pipeline) {
    logMsg("window.pipeline is defined");

    const model_id = "onnx-community/Janus-1.3B-ONNX";//https://huggingface.co/onnx-community/Janus-1.3B-ONNX
    processor = await AutoProcessor.from_pretrained(model_id);
    logMsg("processor is loaded");
    logMsg("Start loading the model");
    model = await MultiModalityCausalLM.from_pretrained(model_id, {
      dtype: {
        // everything is set to q4, supposed to be smallest model. total model size - 2.1GB
        /*prepare_inputs_embeds: "q4",
        language_model: "q4",
        lm_head: "q4",
        gen_head: "q4",
        gen_img_embeds: "q4",
        image_decode: "q4", // or keep fp32 if needed*/
        
        // settings from official example. total model size - 2.4GB. Works on my Lenovoi Laptop!!!
        /*prepare_inputs_embeds: "q4",
        language_model: "q4f16",
        lm_head: "fp16",
        gen_head: "fp16",
        gen_img_embeds: "fp16",
        image_decode: "fp32",*/
        
        // different tests.
        // this is the highest working model. any changes to fp32 does not work.
        prepare_inputs_embeds: "fp16",//fp32 does not work, fp16 works.
        language_model: "fp16",
        lm_head: "fp16",
        gen_head: "fp16",
        gen_img_embeds: "fp16",
        image_decode: "fp32",
      },
      device: {
        prepare_inputs_embeds: "wasm", // TODO use "webgpu" when bug is fixed
        language_model: "webgpu",
        lm_head: "webgpu",
        gen_head: "webgpu",
        gen_img_embeds: "webgpu",
        image_decode: "webgpu",
      }
    });
    
    logMsg("model is loaded");
    generateBtnEl.disabled = false;
    generateAppendBtnEl.disabled = false;
  } else {
    logMsg("window.HFPipeline is not defined");
  }
});

async function generateImage(appendImage) {
  setTimeout(() => {
    generateBtnEl.disabled = true;
    generateAppendBtnEl.disabled = true;
  }, 20)
  await sleep(100);
  try {
    const promptText = document.getElementById("prompt_text").value;
    logMsg(`promptText: ${promptText}`);
    // Prepare inputs
    const conversation = [
      {
        role: "User",
        content: promptText
      },
    ];
    const inputs = await processor(conversation, { chat_template: "text_to_image" });
    logMsg("inputs are created");

    // Generate response
    const num_image_tokens = processor.num_image_tokens;
    logMsg(`num_image_tokens: ${num_image_tokens}`);
    const outputs = await model.generate_images({
      ...inputs,
      min_new_tokens: num_image_tokens,
      max_new_tokens: num_image_tokens,
      do_sample: true,
    });
    logMsg("outputs are generated");

    // Save the generated image
    //await outputs[0].save("test.png");//this call initiates image download in browser


    const blob = await outputs[0].toBlob();
    const dataUrl = URL.createObjectURL(blob);

    // Find the existing <img> element and replace its content
    const imgEl = document.getElementById("generated_img");
    if (!appendImage) {
      imgEl.src = dataUrl;
    } else {
      const img = document.createElement("img");
      img.src = dataUrl;
      img.style.maxWidth = "512px"; // optional styling
      document.body.appendChild(img);
    }
  } catch (err) {
    logMsg(`Error happened: ${err.generateBtnEl}`, err, true, true)
  } finally {
    logMsg("Processing Finished");
    document.getElementById("gen_btn").disabled = false;
    generateAppendBtnEl.disabled = false;
  }
}

function logMsg(msg, objectToLog = null, isError = false, forceDebug = false) {
  if ((isDebug) || (forceDebug)) {
    const currDate = getCurrDateAsString();
    if (objectToLog) {
      if (isError) {
        console.error(`[${currDate}] [ERROR] ${msg}`, objectToLog);
      } else {
        console.log(`[${currDate}] [DEBUG] ${msg}`, objectToLog);
      }
    } else {
      if (isError) {
        console.error(`[${currDate}] [ERROR] ${msg}`);
      } else {
        console.log(`[${currDate}] [DEBUG] ${msg}`);
      }
    }
  }
}

function getCurrDateAsString(isISO8601DateFormat = false) {
  const date = new Date();
  const year = date.getFullYear();
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

  if (isISO8601DateFormat) {
    return `${year}${month}${day}_${hours}${minutes}${seconds}`;
  } else {
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}