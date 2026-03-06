# Sample Game: Complete Nakama Integration Tutorial

## Overview

This tutorial will guide you through building a complete Unity game integrated with Nakama. We'll create a simple **Quiz Game** that demonstrates all core features:

- User authentication and identity management
- Score submission and leaderboards
- Wallet management
- Real-time leaderboard updates

## Prerequisites

- Unity 2020.3 or later
- Nakama Unity SDK installed
- Your Game ID: `your-quiz-game-uuid`
- Nakama server running and accessible

## Project Setup

### Step 1: Create New Unity Project

1. Open Unity Hub
2. Create new **2D Core** project
3. Name it "QuizGameNakama"
4. Open the project

### Step 2: Import Nakama SDK

Follow the [Unity Quick Start Guide](../unity/Unity-Quick-Start.md#installation) to install the Nakama Unity SDK.

### Step 3: Project Structure

Create the following folder structure:

```
Assets/
├── Scripts/
│   ├── Nakama/
│   │   ├── NakamaConnection.cs
│   │   ├── PlayerIdentity.cs
│   │   ├── ScoreManager.cs
│   │   ├── WalletManager.cs
│   │   └── LeaderboardManager.cs
│   ├── Game/
│   │   ├── QuizManager.cs
│   │   ├── Question.cs
│   │   └── QuizUI.cs
│   └── UI/
│       ├── MainMenuUI.cs
│       ├── LeaderboardUI.cs
│       └── WalletUI.cs
├── Scenes/
│   ├── MainMenu.scene
│   ├── Game.scene
│   └── Leaderboard.scene
└── Prefabs/
    ├── LeaderboardEntry.prefab
    └── QuestionPanel.prefab
```

## Implementation

### Part 1: Nakama Core Scripts

#### NakamaConnection.cs

```csharp
using Nakama;
using UnityEngine;
using System.Threading.Tasks;

public class NakamaConnection : MonoBehaviour
{
    // Configure these for your server
    private const string ServerKey = "defaultkey";
    private const string Host = "localhost";
    private const int Port = 7350;
    private const string GameId = "your-quiz-game-uuid"; // REPLACE WITH YOUR GAME ID
    
    private static NakamaConnection instance;
    public static NakamaConnection Instance => instance;
    
    private IClient client;
    private ISession session;
    
    public IClient Client => client;
    public ISession Session => session;
    public string DeviceId { get; private set; }
    public string CurrentGameId => GameId;
    public bool IsConnected => session != null && !session.IsExpired;
    
    void Awake()
    {
        if (instance == null)
        {
            instance = this;
            DontDestroyOnLoad(gameObject);
            Debug.Log("[Nakama] Instance created");
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    void Start()
    {
        InitializeAsync();
    }
    
    async void InitializeAsync()
    {
        await Initialize();
    }
    
    public async Task Initialize()
    {
        Debug.Log("[Nakama] Initializing connection...");
        
        // Create client
        client = new Client("http", Host, Port, ServerKey);
        
        // Get or generate device ID
        DeviceId = GetOrCreateDeviceId();
        Debug.Log($"[Nakama] Device ID: {DeviceId}");
        
        // Authenticate
        await AuthenticateDevice();
        
        Debug.Log("[Nakama] Initialization complete!");
    }
    
    string GetOrCreateDeviceId()
    {
        const string KEY = "nakama_device_id";
        
        if (!PlayerPrefs.HasKey(KEY))
        {
            string newId = System.Guid.NewGuid().ToString();
            PlayerPrefs.SetString(KEY, newId);
            PlayerPrefs.Save();
            Debug.Log($"[Nakama] Generated new device ID: {newId}");
        }
        
        return PlayerPrefs.GetString(KEY);
    }
    
    async Task AuthenticateDevice()
    {
        try
        {
            Debug.Log("[Nakama] Authenticating...");
            session = await client.AuthenticateDeviceAsync(DeviceId);
            Debug.Log($"[Nakama] Authenticated successfully! User ID: {session.UserId}");
        }
        catch (System.Exception ex)
        {
            Debug.LogError($"[Nakama] Authentication failed: {ex.Message}");
            throw;
        }
    }
    
    public async Task<bool> EnsureConnected()
    {
        if (!IsConnected)
        {
            await Initialize();
        }
        return IsConnected;
    }
}
```

#### PlayerIdentity.cs

```csharp
using Nakama;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

[Serializable]
public class IdentityResponse
{
    public bool success;
    public bool created;
    public string username;
    public string device_id;
    public string game_id;
    public string wallet_id;
    public string global_wallet_id;
}

public class PlayerIdentity : MonoBehaviour
{
    private static PlayerIdentity instance;
    public static PlayerIdentity Instance => instance;
    
    private IdentityResponse currentIdentity;
    public IdentityResponse CurrentIdentity => currentIdentity;
    
    void Awake()
    {
        if (instance == null)
        {
            instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public async Task<IdentityResponse> CreateOrSyncUser(string username)
    {
        Debug.Log($"[Identity] Creating/syncing user: {username}");
        
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var deviceId = NakamaConnection.Instance.DeviceId;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        var payload = new Dictionary<string, string>
        {
            { "username", username },
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        try
        {
            var payloadJson = JsonUtility.ToJson(payload);
            var result = await client.RpcAsync(session, "create_or_sync_user", payloadJson);
            
            currentIdentity = JsonUtility.FromJson<IdentityResponse>(result.Payload);
            
            if (currentIdentity.success)
            {
                Debug.Log($"[Identity] User {(currentIdentity.created ? "created" : "synced")}: {currentIdentity.username}");
                Debug.Log($"[Identity] Wallet ID: {currentIdentity.wallet_id}");
                Debug.Log($"[Identity] Global Wallet ID: {currentIdentity.global_wallet_id}");
                
                // Save username locally
                PlayerPrefs.SetString("player_username", username);
                PlayerPrefs.Save();
            }
            
            return currentIdentity;
        }
        catch (Exception ex)
        {
            Debug.LogError($"[Identity] Failed to create/sync user: {ex.Message}");
            throw;
        }
    }
    
    public string GetSavedUsername()
    {
        return PlayerPrefs.GetString("player_username", "Player");
    }
}
```

#### ScoreManager.cs

```csharp
using Nakama;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

[Serializable]
public class ScoreSubmissionResponse
{
    public bool success;
    public int score;
    public int wallet_balance;
    public string[] leaderboards_updated;
    public string game_id;
}

public class ScoreManager : MonoBehaviour
{
    private static ScoreManager instance;
    public static ScoreManager Instance => instance;
    
    public event Action<ScoreSubmissionResponse> OnScoreSubmitted;
    
    void Awake()
    {
        if (instance == null)
        {
            instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public async Task<ScoreSubmissionResponse> SubmitScore(int score)
    {
        Debug.Log($"[Score] Submitting score: {score}");
        
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var deviceId = NakamaConnection.Instance.DeviceId;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        var payload = new Dictionary<string, object>
        {
            { "score", score },
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        try
        {
            var payloadJson = JsonUtility.ToJson(payload);
            var result = await client.RpcAsync(session, "submit_score_and_sync", payloadJson);
            
            var response = JsonUtility.FromJson<ScoreSubmissionResponse>(result.Payload);
            
            if (response.success)
            {
                Debug.Log($"[Score] Score {response.score} submitted successfully!");
                Debug.Log($"[Score] Updated {response.leaderboards_updated.Length} leaderboards");
                Debug.Log($"[Score] New wallet balance: {response.wallet_balance}");
                
                OnScoreSubmitted?.Invoke(response);
            }
            
            return response;
        }
        catch (Exception ex)
        {
            Debug.LogError($"[Score] Failed to submit score: {ex.Message}");
            throw;
        }
    }
}
```

#### WalletManager.cs

```csharp
using Nakama;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

[Serializable]
public class WalletData
{
    public string wallet_id;
    public int balance;
    public string currency;
    public string game_id;
}

[Serializable]
public class WalletResponse
{
    public bool success;
    public WalletData game_wallet;
    public WalletData global_wallet;
}

public class WalletManager : MonoBehaviour
{
    private static WalletManager instance;
    public static WalletManager Instance => instance;
    
    private WalletResponse currentWallets;
    public WalletResponse CurrentWallets => currentWallets;
    
    public event Action<WalletResponse> OnWalletsUpdated;
    
    void Awake()
    {
        if (instance == null)
        {
            instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public async Task<WalletResponse> LoadWallets()
    {
        Debug.Log("[Wallet] Loading wallets...");
        
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var deviceId = NakamaConnection.Instance.DeviceId;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        var payload = new Dictionary<string, string>
        {
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        try
        {
            var payloadJson = JsonUtility.ToJson(payload);
            var result = await client.RpcAsync(session, "create_or_get_wallet", payloadJson);
            
            currentWallets = JsonUtility.FromJson<WalletResponse>(result.Payload);
            
            if (currentWallets.success)
            {
                Debug.Log($"[Wallet] Game Wallet: {currentWallets.game_wallet.balance} {currentWallets.game_wallet.currency}");
                Debug.Log($"[Wallet] Global Wallet: {currentWallets.global_wallet.balance} {currentWallets.global_wallet.currency}");
                
                OnWalletsUpdated?.Invoke(currentWallets);
            }
            
            return currentWallets;
        }
        catch (Exception ex)
        {
            Debug.LogError($"[Wallet] Failed to load wallets: {ex.Message}");
            throw;
        }
    }
    
    public int GetGameWalletBalance()
    {
        return currentWallets?.game_wallet?.balance ?? 0;
    }
    
    public int GetGlobalWalletBalance()
    {
        return currentWallets?.global_wallet?.balance ?? 0;
    }
}
```

#### LeaderboardManager.cs

```csharp
using Nakama;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

public class LeaderboardManager : MonoBehaviour
{
    private static LeaderboardManager instance;
    public static LeaderboardManager Instance => instance;
    
    private Dictionary<string, IApiLeaderboardRecordList> cachedLeaderboards = new Dictionary<string, IApiLeaderboardRecordList>();
    private Dictionary<string, float> cacheTimestamps = new Dictionary<string, float>();
    private const float CACHE_DURATION = 30f; // seconds
    
    void Awake()
    {
        if (instance == null)
        {
            instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    public async Task<IApiLeaderboardRecordList> GetLeaderboard(string leaderboardId, bool forceRefresh = false)
    {
        Debug.Log($"[Leaderboard] Loading leaderboard: {leaderboardId}");
        
        // Check cache
        if (!forceRefresh && cachedLeaderboards.ContainsKey(leaderboardId))
        {
            float age = Time.time - cacheTimestamps[leaderboardId];
            if (age < CACHE_DURATION)
            {
                Debug.Log($"[Leaderboard] Using cached data (age: {age:F1}s)");
                return cachedLeaderboards[leaderboardId];
            }
        }
        
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        
        try
        {
            var result = await client.ListLeaderboardRecordsAsync(session, leaderboardId, null, 100);
            
            // Update cache
            cachedLeaderboards[leaderboardId] = result;
            cacheTimestamps[leaderboardId] = Time.time;
            
            Debug.Log($"[Leaderboard] Loaded {result.Records.Count} records");
            return result;
        }
        catch (Exception ex)
        {
            Debug.LogError($"[Leaderboard] Failed to load leaderboard: {ex.Message}");
            throw;
        }
    }
    
    public async Task<IApiLeaderboardRecordList> GetGameLeaderboard(bool forceRefresh = false)
    {
        var gameId = NakamaConnection.Instance.CurrentGameId;
        return await GetLeaderboard($"leaderboard_{gameId}", forceRefresh);
    }
    
    public async Task<IApiLeaderboardRecordList> GetDailyLeaderboard(bool forceRefresh = false)
    {
        var gameId = NakamaConnection.Instance.CurrentGameId;
        return await GetLeaderboard($"leaderboard_{gameId}_daily", forceRefresh);
    }
    
    public async Task<IApiLeaderboardRecordList> GetGlobalLeaderboard(bool forceRefresh = false)
    {
        return await GetLeaderboard("leaderboard_global", forceRefresh);
    }
    
    public void ClearCache()
    {
        cachedLeaderboards.Clear();
        cacheTimestamps.Clear();
        Debug.Log("[Leaderboard] Cache cleared");
    }
}
```

### Part 2: Game Logic

#### Question.cs

```csharp
using System;

[Serializable]
public class Question
{
    public string questionText;
    public string[] answers;
    public int correctAnswerIndex;
    public int pointValue;
    
    public Question(string text, string[] options, int correct, int points = 10)
    {
        questionText = text;
        answers = options;
        correctAnswerIndex = correct;
        pointValue = points;
    }
    
    public bool IsCorrect(int answerIndex)
    {
        return answerIndex == correctAnswerIndex;
    }
}
```

#### QuizManager.cs

```csharp
using UnityEngine;
using System.Collections.Generic;
using System;

public class QuizManager : MonoBehaviour
{
    public event Action<int> OnScoreChanged;
    public event Action<Question> OnNewQuestion;
    public event Action<bool> OnAnswerSubmitted;
    public event Action<int> OnQuizCompleted;
    
    private List<Question> questions = new List<Question>();
    private int currentQuestionIndex = 0;
    private int score = 0;
    
    void Start()
    {
        InitializeQuestions();
        StartQuiz();
    }
    
    void InitializeQuestions()
    {
        // Add sample quiz questions
        questions.Add(new Question(
            "What is the capital of France?",
            new[] { "London", "Berlin", "Paris", "Madrid" },
            2,
            10
        ));
        
        questions.Add(new Question(
            "What is 2 + 2?",
            new[] { "3", "4", "5", "6" },
            1,
            10
        ));
        
        questions.Add(new Question(
            "Which planet is known as the Red Planet?",
            new[] { "Venus", "Mars", "Jupiter", "Saturn" },
            1,
            10
        ));
        
        questions.Add(new Question(
            "What is the largest ocean?",
            new[] { "Atlantic", "Indian", "Arctic", "Pacific" },
            3,
            10
        ));
        
        questions.Add(new Question(
            "Who painted the Mona Lisa?",
            new[] { "Picasso", "Da Vinci", "Van Gogh", "Rembrandt" },
            1,
            10
        ));
        
        // Shuffle questions
        ShuffleQuestions();
    }
    
    void ShuffleQuestions()
    {
        for (int i = questions.Count - 1; i > 0; i--)
        {
            int j = UnityEngine.Random.Range(0, i + 1);
            var temp = questions[i];
            questions[i] = questions[j];
            questions[j] = temp;
        }
    }
    
    public void StartQuiz()
    {
        currentQuestionIndex = 0;
        score = 0;
        OnScoreChanged?.Invoke(score);
        ShowCurrentQuestion();
    }
    
    void ShowCurrentQuestion()
    {
        if (currentQuestionIndex < questions.Count)
        {
            OnNewQuestion?.Invoke(questions[currentQuestionIndex]);
        }
        else
        {
            EndQuiz();
        }
    }
    
    public void SubmitAnswer(int answerIndex)
    {
        var currentQuestion = questions[currentQuestionIndex];
        bool isCorrect = currentQuestion.IsCorrect(answerIndex);
        
        if (isCorrect)
        {
            score += currentQuestion.pointValue;
            OnScoreChanged?.Invoke(score);
        }
        
        OnAnswerSubmitted?.Invoke(isCorrect);
        
        currentQuestionIndex++;
        
        // Small delay before next question
        Invoke(nameof(ShowCurrentQuestion), 1.5f);
    }
    
    async void EndQuiz()
    {
        Debug.Log($"Quiz completed! Final score: {score}");
        OnQuizCompleted?.Invoke(score);
        
        // Submit score to Nakama
        try
        {
            await ScoreManager.Instance.SubmitScore(score);
            await WalletManager.Instance.LoadWallets();
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to submit score: {ex.Message}");
        }
    }
    
    public int GetCurrentQuestionNumber()
    {
        return currentQuestionIndex + 1;
    }
    
    public int GetTotalQuestions()
    {
        return questions.Count;
    }
    
    public int GetCurrentScore()
    {
        return score;
    }
}
```

This is Part 1 of the sample game tutorial. The tutorial continues with UI implementation, scene setup, and testing in the next sections. Would you like me to continue with the remaining parts?
