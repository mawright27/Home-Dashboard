const timeElement = document.getElementById("clock-time");
const dateElement = document.getElementById("clock-date");
const eventList = document.getElementById("event-list");

function updateClock() {
  const now = new Date();

  timeElement.textContent = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  dateElement.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

updateClock();
setInterval(updateClock, 1000);

eventList.innerHTML = `
  <li class="event-list__empty">
    Basic JavaScript is working
  </li>
`;
