# 🍄 Shumi Discord Trading Bot - Product Requirements Document

## **Executive Summary**

Shumi is a Discord trading bot that enables weekly cryptocurrency trading competitions with real-time price tracking, position management, and leaderboards. The bot features enterprise-grade token resolution, CoinGecko Pro API integration, and supports both traditional Discord slash commands and text-based interactions.

---

## **Core Features**

### **🏆 Trading Competition System**

#### **Weekly Competitions**
- **Competition Cycles**: Automatic weekly competitions (Monday 00:00 UTC reset)
- **User Registration**: `shumi join` - Join current week's competition
- **Multi-Format Support**: Both slash commands (`/join`) and text commands (`shumi join`)

#### **Trade Management**
- **Position Entry**: `shumi enter btc long` or `shumi enter doge short`
- **Position Exit**: `shumi exit btc` - Close open positions
- **Advanced Trading**: `/trade` command with structured options
- **Position Limits**: One position per ticker (no averaging allowed)
- **Trade Types**: Long positions (profit when price rises), Short positions (profit when price falls)

#### **Portfolio Tracking**
- **Personal Positions**: `shumi positions` - View your open positions with live P&L
- **Global Positions**: `shumi positions all` - View everyone's positions
- **Real-time P&L**: Live profit/loss calculations with current market prices
- **Position Details**: Entry price, current price, percentage change, side (long/short)

#### **Leaderboards & Rankings**
- **Weekly Leaderboard**: `shumi leaderboard` - Top 10 performers by realized P&L
- **Current Participants**: Active traders with open positions
- **Historical Tracking**: Closed trades contribute to rankings
- **Performance Metrics**: Realized P&L, number of open positions

---

### **💰 Advanced Price System**

#### **Enterprise Token Resolution**
- **Advanced Resolver**: Intelligent token identification with scoring and filtering
- **Canonical Mappings**: 100+ direct mappings for instant resolution (BTC→bitcoin, ETH→ethereum)
- **Single-Letter Support**: All A-Z letters mapped to prevent ambiguity (W→Wormhole, G→The Graph)
- **Wrapped Token Protection**: Automatically filters out WETH, WBTC, wrapped variants
- **Protocol Token Protection**: Preserves legitimate protocol tokens (Wormhole, Synapse, Multichain)

#### **Trading Pair Detection**
- **Multiple Formats**: `btcusdt`, `eth/usdc`, `ondo-usdt`, `xrp:dai`
- **Automatic Detection**: Bot recognizes trading pairs vs single tokens
- **Base Asset Resolution**: Returns price of base asset in pair
- **Quote Currency Support**: USDT, USDC, BUSD, DAI, and 15+ other quote currencies

#### **Smart Price Fetching**
- **CoinGecko Pro Integration**: Automatic Pro API usage with fallback to free tier
- **Rate Limiting**: Intelligent throttling (1.1 seconds between calls)
- **Caching System**: 1-minute price cache, 1-hour search cache
- **Stale Data Recovery**: Falls back to cached data during API issues
- **Precision Pricing**: Full precision for accurate P&L calculations

#### **Price Commands**
- **Single Token**: `shumi price btc` - Get current price with 24h change and market cap
- **Multiple Tokens**: `shumi price btc eth sol matic` - Up to 6 tokens at once
- **Pair Support**: `shumi price btcusdt` - Automatically detects as BTC/USDT pair
- **Rich Display**: Price, 24h change with emoji indicators, market cap in B/M format

---

### **🤖 User Experience**

#### **Command Interfaces**
- **Text Commands**: `shumi [command]` - Natural language interaction
- **Slash Commands**: `/price`, `/enter`, `/exit`, `/positions`, `/leaderboard`
- **Hybrid Support**: Both interfaces work identically
- **Rate Limiting**: 5 actions per 30 seconds per user

#### **Error Handling & Help**
- **Intelligent Error Messages**: Context-aware suggestions
- **Stablecoin Guidance**: "add 'stablecoin' if you want USDC/DAI"
- **Token Suggestions**: Recommends common tickers when token not found
- **Help System**: `shumi help` - Comprehensive command reference

#### **Rich Embeds & Formatting**
- **Trade Confirmations**: Colored embeds with entry price, side, trade ID
- **Position Displays**: Live P&L with color-coded profit/loss indicators
- **Leaderboard**: Formatted rankings with user stats
- **Price Displays**: Professional formatting with emojis and market data

---

### **🔧 Technical Features**

#### **Database Architecture**
- **PostgreSQL Backend**: Persistent storage for users, competitions, trades
- **User Management**: Discord ID linking with username tracking
- **Trade Tracking**: Complete audit trail with timestamps
- **Competition Management**: Weekly cycle automation with entry tracking

#### **API Integration**
- **CoinGecko Pro**: Primary price data source with enhanced rate limits
- **Discord API**: Full Discord.js v14 integration
- **Environment Configuration**: Secure API key management

#### **Performance & Reliability**
- **Caching Strategy**: Multi-layer caching for performance
- **Error Recovery**: Graceful fallbacks and retry mechanisms
- **Rate Limiting**: Respects API limits and user rate limits
- **Logging**: Comprehensive error logging and debugging

---

### **🛡️ Content & Safety Features**

#### **Auto-Profile System** (Optional)
- **Channel-Specific Control**: Enable/disable per channel via `/autoprofile`
- **Admin Permissions**: Requires Manage Channels permission
- **Image Profile Guard**: Monitors and manages profile changes
- **Toggle Control**: Environment variable to enable/disable features

#### **Admin Tools**
- **Debug Commands**: Admin-only debugging for trade issues
- **Trade Management**: Fix incorrect prices, delete erroneous trades
- **Cache Management**: Clear caches for immediate updates
- **User Management**: Discord ID tracking and username updates

---

## **Technical Architecture**

### **Core Components**

#### **Token Resolution Pipeline**
1. **Canonical Lookup**: Direct mapping for 100+ common tokens
2. **Pair Detection**: Identify trading pairs vs single tokens  
3. **Search & Filter**: CoinGecko search with intelligent filtering
4. **Scoring System**: Rank candidates by relevance and market cap
5. **Result Selection**: Choose best match with context awareness

#### **Price Data Flow**
1. **User Request**: Discord command triggers price fetch
2. **Token Resolution**: Advanced resolver identifies correct token
3. **API Request**: CoinGecko Pro API with caching and rate limiting
4. **Data Processing**: Format prices, calculate changes, add metadata
5. **Response Formatting**: Rich embeds with professional display

#### **Trading System Flow**
1. **Position Entry**: User enters trade with side (long/short)
2. **Price Capture**: Real-time price fetching and storage
3. **Trade Storage**: Database persistence with full audit trail
4. **Position Tracking**: Continuous P&L monitoring
5. **Exit Processing**: Close trades with profit/loss calculation

---

## **Configuration & Deployment**

### **Environment Variables**
```
DISCORD_TOKEN=<bot_token>
DISCORD_CLIENT_ID=<application_id>
DISCORD_GUILD_ID=<guild_id> (optional, for guild commands)
DATABASE_URL=<postgresql_connection_string>
COINGECKO_API_KEY=<pro_api_key>
SHUMI_AUTOPROFILE=<on/off>
SHUMI_CG_BLOCKLIST=<comma_separated_ids> (optional)
NODE_ENV=<development/production>
```

### **Deployment Requirements**
- **Node.js**: v18+ with ES modules support
- **PostgreSQL**: Database with migration support
- **Discord Application**: Bot token and permissions
- **CoinGecko Pro**: API key for enhanced features
- **Platform**: Render, Heroku, or similar Node.js hosting

---

## **User Flows**

### **New User Onboarding**
1. User joins Discord server with Shumi bot
2. User runs `shumi help` to see available commands
3. User runs `shumi join` to enter current week's competition
4. User can immediately start trading with `shumi enter btc long`

### **Typical Trading Session**
1. Check prices: `shumi price btc eth sol`
2. Enter position: `shumi enter btc long`
3. Monitor positions: `shumi positions`
4. Check competition: `shumi leaderboard`
5. Exit position: `shumi exit btc`

### **Price Discovery**
1. User types ambiguous ticker: `shumi price w`
2. Bot resolves to Wormhole token via canonical mapping
3. Returns professional price display with market data
4. User can immediately use for trading decisions

---

## **Success Metrics**

### **User Engagement**
- **Daily Active Users**: Users running commands per day
- **Competition Participation**: Users joining weekly competitions
- **Trade Volume**: Number of positions entered/exited
- **Command Usage**: Most popular commands and features

### **Technical Performance**
- **Response Time**: < 2 seconds for price commands
- **API Reliability**: > 99% successful price fetches
- **Token Resolution Accuracy**: Correct token identification rate
- **Cache Hit Rate**: Percentage of cached vs API requests

### **User Experience**
- **Error Rate**: Percentage of failed commands
- **Support Inquiries**: User confusion or help requests
- **Feature Adoption**: Usage of new features like pair detection
- **User Retention**: Weekly active users over time

---

## **Future Roadmap**

### **Enhanced Trading Features**
- **Position Sizing**: Support for percentage-based position sizes
- **Stop Losses**: Automatic position closure at price levels
- **Portfolio Analytics**: Performance tracking and statistics
- **Trade History**: Comprehensive historical analysis

### **Social Features**
- **Team Competitions**: Guild vs guild trading competitions
- **Achievement System**: Badges for trading milestones
- **Strategy Sharing**: Share successful trading strategies
- **Mentorship**: Connect experienced with new traders

### **Advanced Analytics**
- **Market Analysis**: Technical indicators and market insights
- **Performance Metrics**: Sharpe ratio, drawdown analysis
- **Risk Management**: Position sizing recommendations
- **Market Alerts**: Price movement notifications

---

## **Risk Management**

### **Financial Safety**
- **Paper Trading**: No real money involved, educational purposes only
- **Position Limits**: One position per ticker prevents over-exposure
- **Weekly Resets**: Fresh start each week prevents long-term losses
- **Clear Rules**: Transparent competition rules and calculations

### **Technical Safety**
- **Rate Limiting**: Prevents API abuse and ensures service stability
- **Error Handling**: Graceful failures with helpful error messages
- **Data Validation**: Input validation and sanitization
- **Monitoring**: Comprehensive logging and error tracking

### **User Safety**
- **Privacy**: Minimal data collection, Discord ID only
- **Moderation**: Admin tools for managing problematic users
- **Fair Play**: Transparent calculations and open source verification
- **Support**: Clear help documentation and error guidance

---

## **Competitive Advantages**

1. **Professional Token Resolution**: Rivals major exchanges in accuracy
2. **Trading Pair Support**: Supports modern trading syntax
3. **Real-time Performance**: Live P&L with sub-second updates  
4. **User-Centric Design**: Solves real user pain points
5. **Enterprise Reliability**: Pro API integration with fallbacks
6. **Zero Learning Curve**: Intuitive commands with rich help system

---

*Last Updated: December 2024*
*Version: 2.0 - Post Advanced Resolver Integration*