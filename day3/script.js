let notes = [
  { id: 1, text: "Buy milk and bread", category: "personal" },
  { id: 2, text: "Finish the Day 3 assignment", category: "study" },
  { id: 3, text: "Email the project report to Grace", category: "work" },
  { id: 4, text: "Revise JavaScript arrays", category: "study" },
  { id: 5, text: "Call mum", category: "personal" }
];

function searchNotes(word) {
  const search = word.toLowerCase();
  return notes.filter(function (note) {
    return note.text.toLowerCase().includes(search);
  });
}

function longestNote() {
  if (notes.length === 0) {
    return null;
  }
  let longest = notes[0];
  for (const note of notes) {
    if (note.text.length > longest.text.length) {
      longest = note;
    }
  }
  return longest;
}

function countByCategory() {
  const counts = {};
  for (const note of notes) {
    if (counts[note.category]) {
      counts[note.category] = counts[note.category] + 1;
    } else {
      counts[note.category] = 1;
    }
  }
  return counts;
}

function getSummary() {
  const counts = countByCategory();
  const total = notes.length;
  const word = total === 1 ? "note" : "notes";
  const personal = counts.personal || 0;
  const work = counts.work || 0;
  const study = counts.study || 0;
  return `${total} ${word}: ${personal} personal, ${work} work, ${study} study.`;
}

function cleanText(text) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function isDuplicate(text) {
  const cleaned = cleanText(text);
  return notes.some(function (note) {
    return cleanText(note.text) === cleaned;
  });
}

function addNote(text, category) {
  const cleaned = text.trim();
  const allowed = ["personal", "work", "study"];

  if (cleaned.length < 1 || cleaned.length > 200) {
    console.log("Not added: text must be 1 to 200 characters.");
    return false;
  }
  if (isDuplicate(cleaned)) {
    console.log("Not added: that note already exists.");
    return false;
  }
  if (!allowed.includes(category)) {
    console.log("Not added: category must be personal, work or study.");
    return false;
  }

  let newId = 1;
  for (const note of notes) {
    if (note.id >= newId) {
      newId = note.id + 1;
    }
  }
  notes.push({ id: newId, text: cleaned, category: category });
  return true;
}

console.log(searchNotes("milk"));  
console.log(searchNotes("THE"));   
console.log(searchNotes("zebra")); 

console.log(longestNote()); 
const savedNotes = notes;   
notes = [];
console.log(longestNote()); 
notes = savedNotes;         

console.log(countByCategory()); 
notes = [];
console.log(countByCategory()); 
notes = savedNotes;

console.log(getSummary()); 
notes = [savedNotes[0]];
console.log(getSummary()); 
notes = savedNotes;

console.log(isDuplicate("buy milk and bread"));     
console.log(isDuplicate("  BUY   milk and bread "));     
console.log(isDuplicate("Walk the dog"));           

console.log(addNote("Walk the dog", "personal"));   
console.log(addNote("walk the DOG", "personal"));   
console.log(addNote("   ", "work"));                
console.log(addNote("a".repeat(201), "work"));      
console.log(addNote("Learn CSS grid", "fun"));      
console.log(getSummary()); 