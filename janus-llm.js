let isDebug = true;
let processor = null;
let model = null;
let loadModelBtnEl = document.getElementById("load_model_btn");
let generateBtnEl = document.getElementById("gen_btn");
let generateAppendBtnEl = document.getElementById("gen_add_btn");
let generateTextAnswerBtnEl = document.getElementById("gen_text_btn");
let generateTextAnswerByImageBtnEl = document.getElementById("gen_text_by_img_btn");
let imageInputEl = document.getElementById("prompt_img");

let selectPrecisionEl = document.getElementById("precision_select")
let selectedDevice = "webgpu";

const ALL_POSSIBLE_FALLBACK_PRECISIONS = [
  // these 4 configurations below are commented because they does not work anyway.
  /*{
    label: "FP32 model",
    prepare_inputs_embeds: "fp32",
    language_model: "fp32",
    lm_head: "fp32",
    gen_head: "fp32",
    gen_img_embeds: "fp32",
    image_decode: "fp32",
  },
  {
    label: "FP32-Q4 combination",
    prepare_inputs_embeds: "fp32",
    language_model: "q4",
    lm_head: "fp32",
    gen_head: "fp32",
    gen_img_embeds: "fp32",
    image_decode: "fp32"
  },
  {
    label: "FP16-FP32 combination 1",// failed with error on any PC: undefined 341804528
    prepare_inputs_embeds: "fp16", // fp32 - 2GB, fp16/q4/bnb4 - 1GB, int8/q4f16/quantized/uint8 - 0.5GB
    language_model: "fp16", // fp32 - 4.9GB, fp16 - 2.1GB, q4/q4f16/bnb4 - 0.8GB, int8/quantized/uint8 - 1.2GB 
    lm_head: "fp32",// fp32 - 0.85GB, fp16 - 0.4GB, q4f16/bnb4/q4 - 131MB, int8/quantized/uint8 - 210MB
    gen_head: "fp32", // fp32 - 151MB, fp16 - 76MB, q4/q4f16/bnb4 - 24MB, int8/quantized/uint8 - 38MB
    gen_img_embeds: "fp32",// fp32 - 17MB, fp16 - 9MB, q4/q4f16/bnb4/int8/quantized/uint8 - 4MB
    image_decode: "fp32",// fp32/q4/bnb4 - 170MB, fp16/q4f16 - 85MB, int8/quantized/uint8 - 43MB
  },
  {
    label: "FP16-FP32 combination 2",// failed with the error on any PC: undefined 210426272
    prepare_inputs_embeds: "fp32",
    language_model: "fp16",
    lm_head: "fp32",
    gen_head: "fp32",
    gen_img_embeds: "fp32",
    image_decode: "fp32",
  },*/
  {
    label: "FP16-FP32 combination 3 (text only)",// model loaded but image generation failed with error:  ERROR_MESSAGE: Unexpected input data type. Actual: (tensor(float16)) , expected: (tensor(float)). Text answer works fine.
    prepare_inputs_embeds: "fp16",
    language_model: "fp16",
    lm_head: "fp16",
    gen_head: "fp32",
    gen_img_embeds: "fp32",
    image_decode: "fp32",
  },
  {
    label: "FP16 model",
    prepare_inputs_embeds: "fp16",
    language_model: "fp16",
    lm_head: "fp16",
    gen_head: "fp16",
    gen_img_embeds: "fp16",
    image_decode: "fp32",
  },
  {
    label: "FP16-Q4 combination",
    prepare_inputs_embeds: "q4",
    language_model: "q4f16",
    lm_head: "fp16",
    gen_head: "fp16",
    gen_img_embeds: "fp16",
    image_decode: "fp32"
  },
  {
    label: "INT8 model",
    prepare_inputs_embeds: "int8",
    language_model: "int8",
    lm_head: "int8",
    gen_head: "int8",
    gen_img_embeds: "int8",
    image_decode: "fp32",
  },
  {
    label: "UINT8 model",
    prepare_inputs_embeds: "uint8",
    language_model: "uint8",
    lm_head: "uint8",
    gen_head: "uint8",
    gen_img_embeds: "uint8",
    image_decode: "fp32",
  },
  {
    label: "Q4 model",
    prepare_inputs_embeds: "q4",
    language_model: "q4",
    lm_head: "q4",
    gen_head: "q4",
    gen_img_embeds: "q4",
    image_decode: "fp32",
  },
  {
    label: "Q4+FP16 model",
    prepare_inputs_embeds: "q4f16",
    language_model: "q4f16",
    lm_head: "q4f16",
    gen_head: "q4f16",
    gen_img_embeds: "q4f16",
    image_decode: "fp32",
  },
  {
    label: "BNB4 model",
    prepare_inputs_embeds: "bnb4",
    language_model: "bnb4",
    lm_head: "bnb4",
    gen_head: "bnb4",
    gen_img_embeds: "bnb4",
    image_decode: "fp32",
  },
];


window.addEventListener('load', async function() {
  duplicateConsole();
  logMsg("window loaded");
  if (window.pipeline) {
    loadModelBtnEl.disabled = false;

    // initializa list with model precisions
    ALL_POSSIBLE_FALLBACK_PRECISIONS.forEach((cfg, index) => {
      const option = document.createElement("option");
      option.value = index;
      option.textContent = cfg.label;
      selectPrecisionEl.appendChild(option);
    });
  } else {
    logMsg("window.HFPipeline is not defined");
  }
});

async function loadModel() {
  if (window.pipeline) {
    logMsg("window.pipeline is defined");
    loadModelBtnEl.disabled = true;
    await sleep(100);
    
    selectedDevice = document.getElementById("device_select").value;

    await loadModelWithFallback();
    if (model) {
      loadModelBtnEl.disabled = true;
      toggleGenerateButtonsDisableEnableState(false);
      logMsg("model is loaded successfully");
    } else {
      logMsg("model loading failed. Check console for details.");
      loadModelBtnEl.disabled = false;
    }
  }
}

async function loadModelWithFallback() {
  const model_id = "onnx-community/Janus-1.3B-ONNX";//https://huggingface.co/onnx-community/Janus-1.3B-ONNX
  const fallbackPrecisions = getSelectedPrecisions();
  logMsg("User selected this precisions", fallbackPrecisions);

  let lastError = null;

  processor = await AutoProcessor.from_pretrained(model_id);
  
  for (const [i, dtypeConfig] of fallbackPrecisions.entries()) {
    try {
      logMsg(`Trying to load model on device: ${selectedDevice} with precision set ${i + 1}: ${JSON.stringify(dtypeConfig)}`);

      model = await MultiModalityCausalLM.from_pretrained(model_id, {
        dtype: dtypeConfig,
        device: {
          prepare_inputs_embeds: "wasm", // safer for small modules
          language_model: selectedDevice,
          lm_head: selectedDevice,
          gen_head: selectedDevice,
          gen_img_embeds: selectedDevice,
          image_decode: selectedDevice,
        },
        progress_callback: loadingProgressCallback
      });

      logMsg(`Loaded model successfully with config ${i + 1}`);
      return model;
    } catch (err) {
      lastError = err;
      logMsg(`Failed with config ${i + 1}: ${err.message}`, err, true, true);
    }
  }
  logMsg(`All fallback attempts failed. Last error: ${lastError?.message}`, lastError, true, true);
}

async function generateImage(appendImage) {
  toggleGenerateButtonsDisableEnableState(true);
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
    let imgCount = appendImage ? 10 : 1;

    for (let i = 0; i < imgCount; i++) {
      logMsg(`try to generate image number: ${i}`);
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
        //guidance_scale: 4,
        //temperature: 0.01,  // <1 = more precise. default 1
        //top_p: 0.01,        // <1 = more selective. default 1
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
    }
  } catch (err) {
    logMsg(`Error happened while generating image: ${err.message}`, err, true, true)
  } finally {
    logMsg("Processing Finished (generating image)");
    toggleGenerateButtonsDisableEnableState(false);
  }
}

async function generateTextAnswer() {
  toggleGenerateButtonsDisableEnableState(true);

  await sleep(100);
  try {
    const promptText = document.getElementById("prompt_text").value;
    logMsg(`[generateTextAnswer] promptText: ${promptText}`);

    // Prepare inputs
    const conversation = [
      {
        role: "User",
        content: promptText
      },
    ];

    const inputs = await processor(conversation);
    logMsg("[generateTextAnswer] inputs are created");
    
    // Generate response
    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 150,
      do_sample: false,
    });
    logMsg("[generateTextAnswer] outputs are generated");

    // Decode output
    const new_tokens = outputs.slice(null, [inputs.input_ids.dims.at(-1), null]);
    const decoded = processor.batch_decode(new_tokens, { skip_special_tokens: true });
    const answer = decoded[0];
    logMsg(`[generateTextAnswer] answer: ${answer}`);
    const textAnswerDiv = document.getElementById("generated_text_answer");
    formatAnswerAsHTML(textAnswerDiv, answer);
  } catch (err) {
    logMsg(`[generateTextAnswer] Error happened while generating text answer: ${err.message}`, err, true, true)
  } finally {
    logMsg("[generateTextAnswer] Processing Finished (generating text answer)");
    toggleGenerateButtonsDisableEnableState(false);
  }
}

async function generateTextAnswerByImage() {
  logMsg(`[generateTextAnswerByImage] started`);
  toggleGenerateButtonsDisableEnableState(true);

  await sleep(100);
  try {
    const file = imageInputEl.files[0];
    const promptText = document.getElementById("prompt_text").value;
    logMsg(`[generateTextAnswerByImage] promptText: ${promptText}`);

    // Convert file to dataURL using await
    const dataURL = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    logMsg(`[generateTextAnswerByImage] image loaded: ${dataURL.substring(0, 50)}`);
    
    // Now you can use dataURL directly
    const conversation = [
      {
        role: "User",
        content: "<image_placeholder>\n" + promptText,
        images: [dataURL],
      },
    ];
    
    const inputs = await processor(conversation);
    logMsg("[generateTextAnswerByImage] inputs are created");
    
    // Generate response
    const outputs = await model.generate({
      ...inputs,
      max_new_tokens: 150,
      do_sample: false,
    });
    logMsg("[generateTextAnswerByImage] outputs are generated");

    // Decode output
    const new_tokens = outputs.slice(null, [inputs.input_ids.dims.at(-1), null]);
    const decoded = processor.batch_decode(new_tokens, { skip_special_tokens: true });
    const answer = decoded[0];
    logMsg(`[generateTextAnswerByImage] answer: ${answer}`);
    const textAnswerDiv = document.getElementById("generated_text_answer");
    formatAnswerAsHTML(textAnswerDiv, answer);
  } catch (err) {
    logMsg(`[generateTextAnswerByImage] Error happened while generating text answer: ${err.message}`, err, true, true)
  } finally {
    logMsg("[generateTextAnswerByImage] Processing Finished (generating text answer)");
    toggleGenerateButtonsDisableEnableState(false);
  }
}

function toggleGenerateButtonsDisableEnableState(isDisable) {
  generateBtnEl.disabled = isDisable;
  generateAppendBtnEl.disabled = isDisable;
  generateTextAnswerBtnEl.disabled = isDisable;
  generateTextAnswerByImageBtnEl.disabled = isDisable;
  imageInputEl.disabled = isDisable;
}

function formatAnswerAsHTML(answerEl, answer) {
  let result = answer;
  try {
    result = result.replace(/```latex([\s\S]*?)```/g, (_, math) => {return '$$' + math.trim() + '$$';});
    // Convert Markdown to HTML

    const html = DOMPurify.sanitize(marked.parse(result, {
      highlight: (code, lang) => {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        // fallback: auto-detect or no highlighting
        return hljs.highlightAuto(code).value;
      }
    }));

    // Create a temporary container to render math
    const container = document.createElement("div");
    container.innerHTML = html;

    // Render LaTeX math inside the container
    renderMathInElement(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },   // block math
        { left: "$", right: "$", display: false }     // inline math
      ]
    });
    result = container.innerHTML;
    
    answerEl.innerHTML = result;
    
    document.querySelectorAll("#generated_text_answer pre code").forEach((codeBlock) => {
      const pre = codeBlock.parentNode;
      const button = document.createElement("button");
      button.textContent = "Copy";
      button.className = "copy-btn";
      pre.appendChild(button);

      button.addEventListener("click", () => {
        navigator.clipboard.writeText(codeBlock.innerText).then(() => {
          button.textContent = "Copied!";
          setTimeout(() => (button.textContent = "Copy"), 2000);
        });
      });
    });
    hljs.highlightAll();
  } catch (err) {
    logMsg("Error during model answer markup formatting. Original model answer will be returned.", err, true, true);
    answerEl.innerHTML = result;
  }
}

function getSelectedPrecisions() {
  const selectedIndices = Array.from(selectPrecisionEl.selectedOptions).map(opt => parseInt(opt.value));

  // Remove 'label' for the final array
  const fallbackPrecisions = selectedIndices.map(i => {
    const { label, ...cfg } = ALL_POSSIBLE_FALLBACK_PRECISIONS[i];
    return cfg;
  });

  return fallbackPrecisions;
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

function duplicateConsole() {
  const outputDiv = document.getElementById("console_output");
  
  ["log", "warn", "error", "debug", "info"].forEach(method => {
    const original = console[method]; // save original
    
    console[method] = (...args) => {
      // Convert all arguments to string (objects → JSON)
      const msg = args.map(a => (typeof a === "object" ? JSON.stringify(a) : a)).join(" ");
      const p = document.createElement("div");
      p.textContent = msg;
      outputDiv.appendChild(p);
      
      // Call original console method
      original.apply(console, args);
    };
  });
}

function clearConsoleDiv() {
  document.getElementById("console_output").innerHTML = "";
}

function loadingProgressCallback(progressInfo) {
  //logMsg(`Loading progress`, progressInfo);
  //progressInfo obje example: obj{"status":"progress","name":"onnx-community/Janus-1.3B-ONNX","file":"generation_config.json","progress":100,"loaded":167,"total":167}'
  if (progressInfo?.status == "progress") {
    document.getElementById("load_progress").innerHTML = `${progressInfo?.progress?.toFixed(2)}% [${progressInfo?.file}]`;
  }
}
