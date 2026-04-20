# 📘 Project-Based Learning (PBL) Report

**Subject:** Next Generation Databases (MongoDB)  
**Project Title:** StockPulse — Real-Time High-Frequency Analytics Dashboard  
**Student Name:** Ansh Chauhan  
**Academic Year:** 2026-27  

---

## 1. Abstract
This project demonstrates the implementation of a high-concurrency, real-time stock analytics platform using **MongoDB** as a next-generation document-oriented database. Unlike traditional relational databases that rely on polling, this system utilizes **MongoDB Change Streams** to achieve sub-millisecond data reactivity. The application features live price streaming, paper trading simulation, news sentiment analysis, and algorithmic signal generation.

---

## 2. Introduction
In the modern financial landscape, data becomes obsolete in seconds. Traditional RDBMS architectures struggle with the velocity and volume of high-frequency tick data. This project explores how **NoSQL** databases, specifically MongoDB, provide the horizontal scalability and event-driven features required for real-time financial dashboards.

### Objectives:
- Implement an event-driven data pipeline using **Node.js** and **MongoDB**.
- Utilize **Change Streams** for real-time UI updates without database polling.
- Implement **TTL (Time-To-Live) Indexes** for automated data lifecycle management.
- Build a functional **Paper Trading** engine and **Sentiment Analysis** system.

---

## 3. Technology Stack
- **Database:** MongoDB Atlas (NoSQL Document Store)
- **Backend:** Node.js, Express.js
- **Real-Time Engine:** Socket.io, WebSockets (Finnhub API)
- **Frontend:** HTML5, CSS3 (Vanilla), Chart.js
- **Algorithms:** SMA Crossover (Quantitative Analysis)

---

## 4. Database Design & Implementation (Core Subject)

### 4.1. Schema-less Architecture
StockPulse stores "Ticks" as documents. MongoDB’s flexible schema allows us to store varying metadata for different asset classes (Stocks vs. Crypto) within the same collection.

**Tick Document Structure:**
```json
{
  "_id": "65f2a...",
  "symbol": "AAPL",
  "price": 195.42,
  "volume": 1200,
  "timestamp": "2026-04-20T17:30:00Z",
  "change": -0.15,
  "changePercent": -0.07
}
```

### 4.2. Next-Gen Feature: Change Streams
The most critical part of this project is the use of **MongoDB Change Streams**. Instead of the server asking the database "Is there new data?", the database **pushes** an event to the Node.js server the moment a new tick is inserted.

```javascript
// Implementation Snippet
const changeStream = ticksCollection.watch();
changeStream.on('change', (next) => {
  if (next.operationType === 'insert') {
    io.emit('tick', next.fullDocument);
  }
});
```

### 4.3. Automated Data Retention (TTL Indexes)
Financial tick data grows exponentially. To prevent storage bloat, we implemented a **TTL Index** that automatically deletes documents older than 24 hours. This ensures the database remains performant without manual maintenance.

```javascript
await ticksCollection.createIndex(
  { "timestamp": 1 }, 
  { expireAfterSeconds: 86400 } // 24 Hours
);
```

---

## 5. System Architecture
![Architecture Diagram](https://mermaid.ink/img/pako:eNqNUstuwjAQ_BVrT0gV-IDDqYdUqR669NCLpA-xN7GFrYod20GoEP-u7YQEKKInX8Z7ZmfG9m6U0pIpyvC-VGrNFO07pbXi6lHpx6U3V5Gv6Hh7v3z8eHx9ez_ef6CHv-gO_f5I_86u0U1_fH96eX57eXs7_kR_jujuj3uM0T8T8_pD_539_on-EGPvT-hD9IdI9IdI9IdI_GdiGvXv5p85mIis5R0T4L4vR1Yy26W9E_C-L9mByHZuS-B9X068YHZLe_6C-76cBsHslt78Bfcl6v_e?type=png)

---

## 6. Results & Visual Analysis

### 6.1. Real-Time Dashboard
The dashboard provides a unified view of market events, portfolio performance, and technical signals.

![Main Dashboard](https://raw.githubusercontent.com/Anshchauhanhub/Stockpulse-/feat/stock-dashboard/public/img/dashboard_full.png)
*(Note: Replace with your actual screenshot from the repository)*

### 6.2. Paper Trading & P&L Tracking
The system manages a virtual $100,000 portfolio. It calculates real-time Profit & Loss by comparing the weighted average cost of holdings against the live market price provided by MongoDB.

### 6.3. Sentiment & Algorithmic Signals
By processing news headlines and calculating Simple Moving Averages (SMA-10/20), the system generates "Strong Buy" and "Strong Sell" signals, displayed via live toast notifications.

---

## 7. Conclusion
This project successfully demonstrates the power of **Next Generation Databases** in handling high-velocity data. By leveraging MongoDB's event-driven features, we built a system that is significantly more responsive and maintainable than traditional polling-based architectures.

### Future Enhancements:
1.  **Sharding:** Implementing MongoDB sharding for global scalability.
2.  **Aggregation Pipelines:** Complex real-time technical indicators using MongoDB's aggregation engine.
3.  **Persistence:** Storing full user trade history in a secondary collection.

---

## 8. References
- MongoDB Documentation: *Change Streams & TTL Indexes*
- Finnhub API Documentation: *Real-time WebSockets*
- Chart.js: *Real-time Data Visualization*
