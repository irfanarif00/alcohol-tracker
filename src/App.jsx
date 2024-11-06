import { useState, useEffect } from 'react';
import { formatDistanceToNow, subHours, differenceInMinutes, addMinutes, format } from 'date-fns';
import { Download } from 'lucide-react';

// Utility functions for localStorage
const getStoredUsers = () => {
  const users = localStorage.getItem('alcoholTracker');
  return users ? JSON.parse(users) : {};
};

const getStoredWaitingTime = () => {
  const time = localStorage.getItem('waitingTime');
  return time ? parseInt(time, 10) : 60; // Default 60 minutes
};

const saveUsers = (users) => {
  localStorage.setItem('alcoholTracker', JSON.stringify(users));
};

const saveWaitingTime = (minutes) => {
  localStorage.setItem('waitingTime', minutes.toString());
};

const calculateRecentConsumption = (records, hoursAgo) => {
  const now = new Date();
  const cutoffTime = subHours(now, hoursAgo);
  return records
    .filter(record => new Date(record.timestamp) > cutoffTime)
    .reduce((sum, record) => sum + record.amount, 0);
};

const getWaitingTime = (lastConsumptionTime, waitingMinutes) => {
  const now = new Date();
  const waitTimeAfterLast = addMinutes(new Date(lastConsumptionTime), waitingMinutes);
  const waitMinutes = differenceInMinutes(waitTimeAfterLast, now);
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
  csvRows.push(['Total Consumption', '', records.reduce((sum, record) => sum + record.amount, 0).toFixed(1) + ' ml']);
  
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
        record.amount.toFixed(1)
      ]);
    });
    
    // Add user summary
    csvRows.push([]);
    csvRows.push([
      `Total for ${userId}`,
      '',
      '',
      records.reduce((sum, record) => sum + record.amount, 0).toFixed(1) + ' ml'
    ]);
    csvRows.push([]); // Empty row between users
  });

  // Add grand total
  const grandTotal = Object.values(users).reduce(
    (total, records) => total + records.reduce((sum, record) => sum + record.amount, 0),
    0
  );
  csvRows.push(['Grand Total', '', '', grandTotal.toFixed(1) + ' ml']);

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
  const [waitingMinutes, setWaitingMinutes] = useState(getStoredWaitingTime());
  const [suggestions, setSuggestions] = useState([]);
  const [isInputActive, setIsInputActive] = useState(false);

  // Get suggestions based on input
  useEffect(() => {
    if (userId.trim()) {
      const users = getStoredUsers();
      const matches = Object.keys(users).filter(id => 
        id.toLowerCase().includes(userId.toLowerCase())
      );
      setSuggestions(matches);
    } else {
      setSuggestions([]);
    }
  }, [userId]);

  // Load and display user data when ID is entered
  const handleSearch = (selectedId = userId) => {
    const users = getStoredUsers();
    if (users[selectedId]) {
      setCurrentUser(selectedId);
      setRecords(users[selectedId]);
      setShowNewUserPrompt(false);
      setUserId(selectedId);
      setSuggestions([]);
    } else {
      setShowNewUserPrompt(true);
      setCurrentUser(null);
      setRecords([]);
    }
  };

  // Handle suggestion selection
  const handleSuggestionClick = (suggestion) => {
    handleSearch(suggestion);
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
      amount: parseFloat(amount)
    };
    
    users[currentUser] = [...(users[currentUser] || []), newRecord];
    saveUsers(users);
    setRecords(users[currentUser]);
    setAmount('');
  };

  // Handle waiting time change
  const handleWaitingTimeChange = (e) => {
    const newTime = parseInt(e.target.value, 10);
    if (newTime > 0) {
      setWaitingMinutes(newTime);
      saveWaitingTime(newTime);
    }
  };

  const totalConsumption = records.reduce((sum, record) => sum + record.amount, 0);
  const last2HoursConsumption = calculateRecentConsumption(records, 2);
  const lastConsumptionTime = records.length > 0 ? records[records.length - 1].timestamp : null;
  const minutesSinceLastConsumption = lastConsumptionTime 
    ? differenceInMinutes(new Date(), new Date(lastConsumptionTime))
    : null;
  const waitingTimeNeeded = lastConsumptionTime ? getWaitingTime(lastConsumptionTime, waitingMinutes) : 0;

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-4">
      <div className="max-w-md mx-auto">
        <div className="flex flex-col mb-6">
          <div className="flex justify-between items-center">
            <h1 className="text-3xl font-bold mb-2 text-gray-800 dark:text-white">
              Alcohol Consumption Tracker
            </h1>
            <button
              onClick={downloadAllUsersCSV}
              className="text-purple-500 hover:text-purple-600 focus:outline-none"
              title="Download All Users Data"
            >
              <Download size={24} />
            </button>
          </div>
        </div>
        
        {/* Waiting Time Settings */}
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="font-bold mb-2 text-gray-800 dark:text-white">Waiting Time Settings</h3>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={waitingMinutes}
              onChange={handleWaitingTimeChange}
              min="1"
              className="w-20 px-2 py-1 border rounded-lg bg-white dark:bg-gray-700 dark:text-white dark:border-gray-600"
            />
            <span className="text-gray-700 dark:text-gray-200">minutes between drinks</span>
          </div>
        </div>
        
        {/* User ID Input with Autocomplete */}
        <div className="mb-6 relative">
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              onFocus={() => setIsInputActive(true)}
              placeholder="Enter User ID"
              className="flex-grow px-4 py-2 border rounded-lg bg-white dark:bg-gray-800 dark:text-white dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => handleSearch()}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Search
            </button>
          </div>
          
          {/* Suggestions dropdown */}
          {suggestions.length > 0 && isInputActive && (
            <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-lg">
              {suggestions.map((suggestion, index) => (
                <div
                  key={index}
                  className="px-4 py-2 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200"
                  onClick={() => handleSuggestionClick(suggestion)}
                >
                  {suggestion}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New User Prompt */}
        {showNewUserPrompt && (
          <div className="mb-6 p-4 bg-yellow-100 dark:bg-yellow-900 rounded-lg">
            <p className="text-yellow-800 dark:text-yellow-100">User not found. Would you like to create a new user?</p>
            <button
              onClick={handleCreateUser}
              className="mt-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              Create New User
            </button>
          </div>
        )}

        {/* Consumption Warning */}
        {currentUser && lastConsumptionTime && minutesSinceLastConsumption < waitingMinutes && (
          <div className="mb-6 p-4 bg-red-100 dark:bg-red-900 rounded-lg border border-red-500">
            <p className="font-bold text-red-800 dark:text-red-100">Warning!</p>
            <p className="text-red-700 dark:text-red-200">
              Please wait {waitingTimeNeeded} minutes before next consumption.
              (Recommended {waitingMinutes} minutes between drinks)
            </p>
          </div>
        )}

        {/* Add Record Form */}
        {currentUser && (
          <div className="mb-6">
            <h2 className="text-xl mb-2 font-semibold text-gray-800 dark:text-white">
              Add Consumption Record for User {currentUser}
            </h2>
            <form onSubmit={handleAddRecord} className="flex gap-2">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount (ml)"
                min="0"
                step="0.1"
                className="flex-grow px-4 py-2 border rounded-lg bg-white dark:bg-gray-800 dark:text-white dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                Add Record
              </button>
            </form>
          </div>
        )}

        {/* Consumption Statistics */}
        {currentUser && records.length > 0 && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/50 rounded-lg">
            <div className="flex justify-between items-center">
              <h3 className="font-bold mb-2 text-gray-800 dark:text-white">Consumption Statistics</h3>
              <button
                onClick={() => downloadCSV(records, currentUser)}
                className="text-purple-500 hover:text-purple-600 focus:outline-none"
                title="Download User Data"
              >
                <Download size={20} />
              </button>
            </div>
            <ul className="space-y-1 text-gray-700 dark:text-gray-200">
              <li>Total consumption: {totalConsumption.toFixed(1)} ml</li>
              <li>Last 2 hours: {last2HoursConsumption.toFixed(1)} ml</li>
              <li>Time since last drink: {formatDistanceToNow(new Date(records[records.length - 1].timestamp))}</li>
            </ul>
          </div>
        )}

        {/* Records Display */}
        {currentUser && records.length > 0 && (
          <div>
            <h2 className="text-xl mb-2 font-semibold text-gray-800 dark:text-white">Consumption Records</h2>
            <div className="border dark:border-gray-700 rounded-lg p-4">
              <ul className="space-y-2">
                {records.map((record, index) => (
                  <li key={index} className="border-b dark:border-gray-700 pb-2 text-gray-700 dark:text-gray-200">
                    Amount: {record.amount.toFixed(1)} ml
                    <br />
                    Time: {new Date(record.timestamp).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
