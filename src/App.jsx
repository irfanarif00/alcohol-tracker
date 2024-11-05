import { useState } from 'react';
import { formatDistanceToNow, subHours, differenceInMinutes, addHours, format } from 'date-fns';

// Utility functions for localStorage
const getStoredUsers = () => {
  const users = localStorage.getItem('alcoholTracker');
  return users ? JSON.parse(users) : {};
};

const saveUsers = (users) => {
  localStorage.setItem('alcoholTracker', JSON.stringify(users));
};

const calculateRecentConsumption = (records, hoursAgo) => {
  const now = new Date();
  const cutoffTime = subHours(now, hoursAgo);
  return records
    .filter(record => new Date(record.timestamp) > cutoffTime)
    .reduce((sum, record) => sum + record.amount, 0);
};

const getWaitingTime = (lastConsumptionTime) => {
  const now = new Date();
  const oneHourAfterLast = addHours(new Date(lastConsumptionTime), 1);
  const waitMinutes = differenceInMinutes(oneHourAfterLast, now);
  return waitMinutes > 0 ? waitMinutes : 0;
};

const downloadCSV = (records, userId) => {
  // Create CSV content
  const headers = ['Date', 'Time', 'Amount (ml)'];
  const csvRows = [headers];

  records.forEach(record => {
    const date = new Date(record.timestamp);
    csvRows.push([
      format(date, 'yyyy-MM-dd'),
      format(date, 'HH:mm:ss'),
      record.amount
    ]);
  });

  // Add summary data
  csvRows.push([]);  // Empty row
  csvRows.push(['Total Consumption', '', records.reduce((sum, record) => sum + record.amount, 0) + ' ml']);
  
  // Convert to CSV string
  const csvContent = csvRows.map(row => row.join(',')).join('\n');
  
  // Create and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `alcohol_consumption_${userId}_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const downloadAllUsersCSV = () => {
  const users = getStoredUsers();
  
  // Create CSV content
  const headers = ['User ID', 'Date', 'Time', 'Amount (ml)'];
  const csvRows = [headers];

  // Add data for each user
  Object.entries(users).forEach(([userId, records]) => {
    if (records.length === 0) return; // Skip users with no records
    
    records.forEach(record => {
      const date = new Date(record.timestamp);
      csvRows.push([
        userId,
        format(date, 'yyyy-MM-dd'),
        format(date, 'HH:mm:ss'),
        record.amount
      ]);
    });
    
    // Add user summary
    csvRows.push([]);
    csvRows.push([
      `Total for ${userId}`,
      '',
      '',
      records.reduce((sum, record) => sum + record.amount, 0) + ' ml'
    ]);
    csvRows.push([]); // Empty row between users
  });

  // Add grand total
  const grandTotal = Object.values(users).reduce(
    (total, records) => total + records.reduce((sum, record) => sum + record.amount, 0),
    0
  );
  csvRows.push(['Grand Total', '', '', grandTotal + ' ml']);

  // Convert to CSV string
  const csvContent = csvRows.map(row => row.join(',')).join('\n');
  
  // Create and trigger download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `all_users_alcohol_consumption_${format(new Date(), 'yyyy-MM-dd')}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export default function App() {
  const [userId, setUserId] = useState('');
  const [showNewUserPrompt, setShowNewUserPrompt] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [amount, setAmount] = useState('');
  const [records, setRecords] = useState([]);

  // Load and display user data when ID is entered
  const handleSearch = () => {
    const users = getStoredUsers();
    if (users[userId]) {
      setCurrentUser(userId);
      setRecords(users[userId]);
      setShowNewUserPrompt(false);
    } else {
      setShowNewUserPrompt(true);
      setCurrentUser(null);
      setRecords([]);
    }
  };

  // Create new user
  const handleCreateUser = () => {
    const users = getStoredUsers();
    users[userId] = [];
    saveUsers(users);
    setCurrentUser(userId);
    setRecords([]);
    setShowNewUserPrompt(false);
  };

  // Add new consumption record
  const handleAddRecord = (e) => {
    e.preventDefault();
    if (!amount || !currentUser) return;

    const users = getStoredUsers();
    const newRecord = {
      timestamp: new Date().toISOString(),
      amount: parseInt(amount, 10)
    };
    
    users[currentUser] = [...(users[currentUser] || []), newRecord];
    saveUsers(users);
    setRecords(users[currentUser]);
    setAmount('');
  };

  const totalConsumption = records.reduce((sum, record) => sum + record.amount, 0);
  const last2HoursConsumption = calculateRecentConsumption(records, 2);
  const lastConsumptionTime = records.length > 0 ? records[records.length - 1].timestamp : null;
  const minutesSinceLastConsumption = lastConsumptionTime 
    ? differenceInMinutes(new Date(), new Date(lastConsumptionTime))
    : null;
  const waitingTimeNeeded = lastConsumptionTime ? getWaitingTime(lastConsumptionTime) : 0;

  return (
    <div className="p-4 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Alcohol Consumption Tracker</h1>
      
      {/* User ID Input and All Users Download */}
      <div className="mb-4 flex gap-2 items-center">
        <input
          type="text"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Enter User ID"
          className="border p-2 rounded flex-grow"
        />
        <button
          onClick={handleSearch}
          className="bg-blue-500 text-white px-4 py-2 rounded whitespace-nowrap"
        >
          Search
        </button>
        <button
          onClick={downloadAllUsersCSV}
          className="bg-purple-500 text-white px-4 py-2 rounded whitespace-nowrap flex items-center gap-1"
          title="Download data for all users"
        >
          Download All
        </button>
      </div>

      {showNewUserPrompt && (
        <div className="mb-4 p-4 bg-yellow-100 rounded">
          <p>User not found. Would you like to create a new user?</p>
          <button
            onClick={handleCreateUser}
            className="bg-green-500 text-white px-4 py-2 rounded mt-2"
          >
            Create New User
          </button>
        </div>
      )}

      {/* Consumption Warning */}
      {currentUser && lastConsumptionTime && minutesSinceLastConsumption < 60 && (
        <div className="mb-4 p-4 bg-red-100 rounded border border-red-500">
          <p className="text-red-700 font-bold">Warning!</p>
          <p className="text-red-600">
            Please wait {waitingTimeNeeded} minutes before next consumption.
            (Recommended 1 hour between drinks)
          </p>
        </div>
      )}

      {/* Add Record Form */}
      {currentUser && (
        <div className="mb-4">
          <h2 className="text-xl mb-2">Add Consumption Record for User {currentUser}</h2>
          <form onSubmit={handleAddRecord} className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (ml)"
              min="0"
              step="1"
              className="border p-2 rounded"
            />
            <button
              type="submit"
              className="bg-green-500 text-white px-4 py-2 rounded"
            >
              Add Record
            </button>
          </form>
        </div>
      )}

      {/* Consumption Statistics */}
      {currentUser && records.length > 0 && (
        <div className="mb-4 p-4 bg-blue-50 rounded">
          <h3 className="font-bold mb-2">Consumption Statistics</h3>
          <ul className="space-y-1">
            <li>Total consumption: {totalConsumption} ml</li>
            <li>Last 2 hours: {last2HoursConsumption} ml</li>
            <li>Time since last drink: {formatDistanceToNow(new Date(records[records.length - 1].timestamp))}</li>
          </ul>
          <button
            onClick={() => downloadCSV(records, currentUser)}
            className="mt-3 bg-purple-500 text-white px-4 py-2 rounded flex items-center gap-2"
          >
            <span>Download Data (CSV)</span>
          </button>
        </div>
      )}

      {/* Records Display */}
      {currentUser && records.length > 0 && (
        <div>
          <h2 className="text-xl mb-2">Consumption Records</h2>
          <div className="border rounded p-4">
            <ul className="space-y-2">
              {records.map((record, index) => (
                <li key={index} className="border-b pb-2">
                  Amount: {record.amount} ml
                  <br />
                  Time: {new Date(record.timestamp).toLocaleString()}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
