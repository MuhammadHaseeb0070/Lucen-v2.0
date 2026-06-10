const { loadPyodide } = require("pyodide");

async function main() {
  const pyodide = await loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
  });
  
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  
  try {
    await micropip.install("python-docx");
    console.log("Successfully installed python-docx");
    pyodide.runPython(`
import docx
doc = docx.Document()
doc.add_paragraph('Hello world!')
doc.save('test.docx')
    `);
    const files = pyodide.FS.readdir('.');
    console.log("Files:", files);
    console.log("Success!");
  } catch (err) {
    console.error("Failed to install or run python-docx:", err);
  }
}

main();
