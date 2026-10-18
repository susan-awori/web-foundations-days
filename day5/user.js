const loadBtn = document.getElementById("load-users");
const filterInput = document.getElementById("filter-input");
const statusMsg = document.getElementById("status");
const usersList = document.getElementById("users-list");

const API_URL = "https://jsonplaceholder.typicode.com/userz";

let allUsers = []; 

function renderUsers(list) {
  usersList.textContent = ""; // empty the list first

  for (const user of list) {
    const li = document.createElement("li");

    const name = document.createElement("strong");
    name.textContent = user.name;

    const email = document.createElement("p");
    email.textContent = "Email: " + user.email;

    const city = document.createElement("p");
    city.textContent = "City: " + user.address.city;

    const company = document.createElement("p");
    company.textContent = "Company: " + user.company.name;

    li.append(name, email, city, company);
    usersList.appendChild(li);
  }
}

async function loadUsers() {
  statusMsg.textContent = "Loading users...";
  loadBtn.disabled = true;

  try {
    const response = await fetch(API_URL);

    if (!response.ok) {
      throw new Error("Server answered with status " + response.status);
    }

    allUsers = await response.json();
    renderUsers(allUsers);
    statusMsg.textContent = "Loaded " + allUsers.length + " users.";
  } catch (error) {
    statusMsg.textContent = "Error: could not load users. " + error.message;
  } finally {
    loadBtn.disabled = false;
  }
}

loadBtn.addEventListener("click", loadUsers);

filterInput.addEventListener("input", function () {
  if (allUsers.length === 0) {
    return; // nothing loaded yet, nothing to filter
  }

  const typed = filterInput.value.trim().toLowerCase();

  const matches = allUsers.filter(function (user) {
    return user.name.toLowerCase().includes(typed);
  });

  renderUsers(matches);

  if (matches.length === 0) {
    statusMsg.textContent = "No users match your filter.";
  } else {
    statusMsg.textContent = "Showing " + matches.length + " of " + allUsers.length + " users.";
  }
});