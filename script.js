const inputTextarea = document.getElementById("inputTextarea");
const outputDisplay = document.getElementById("outputDisplay");

const inputChips = document.querySelectorAll("#inputFormatChips .chip");
const outputChips = document.querySelectorAll("#outputFormatChips .chip");

let inputFormat = "binary";
let outputFormat = "binary";

function setActive(chips, activeClass, value) {
  chips.forEach(chip => {
    if (chip.dataset.format === value) {
      chip.classList.add(activeClass);
    } else {
      chip.classList.remove(activeClass);
    }
  });
}

inputChips.forEach(chip => {
  chip.addEventListener("click", () => {
    inputFormat = chip.dataset.format;

    setActive(inputChips, "chip--active", inputFormat);

    convert();
  });
});

outputChips.forEach(chip => {
  chip.addEventListener("click", () => {
    outputFormat = chip.dataset.format;

    setActive(outputChips, "chip--active-output", outputFormat);

    convert();
  });
});

inputTextarea.addEventListener("input", convert);

function textToBinary(text) {
  return [...text]
    .map(c => c.charCodeAt(0).toString(2).padStart(8, "0"))
    .join(" ");
}

function binaryToText(binary) {
  return binary
    .split(" ")
    .map(b => String.fromCharCode(parseInt(b, 2)))
    .join("");
}

function convert() {
  const value = inputTextarea.value.trim();

  if (!value) {
    outputDisplay.textContent = "—";
    return;
  }

  try {

    let text = "";

    if (inputFormat === "text") {
      text = value;
    }

    if (inputFormat === "binary") {
      text = binaryToText(value);
    }

    if (inputFormat === "hex") {
      text = value
        .split(" ")
        .map(h => String.fromCharCode(parseInt(h, 16)))
        .join("");
    }

    if (inputFormat === "decimal") {
      text = value
        .split(" ")
        .map(d => String.fromCharCode(parseInt(d)))
        .join("");
    }

    let result = "";

    if (outputFormat === "text") {
      result = text;
    }

    if (outputFormat === "binary") {
      result = textToBinary(text);
    }

    if (outputFormat === "hex") {
      result = [...text]
        .map(c => c.charCodeAt(0).toString(16).toUpperCase())
        .join(" ");
    }

    if (outputFormat === "decimal") {
      result = [...text]
        .map(c => c.charCodeAt(0))
        .join(" ");
    }

    outputDisplay.textContent = result;

  } catch {
    outputDisplay.textContent = "Invalid Input";
  }
}
