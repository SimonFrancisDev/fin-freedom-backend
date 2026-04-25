import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

// Import the model
import SupportFaq from '../src/models/SupportFaq.js';

const faqs = [
  {
    question: 'How do I connect my wallet to FFN?',
    answer: 'Click the "Connect Wallet" button in the top right corner. Select MetaMask (or your preferred wallet), approve the connection, and ensure you are on the Polygon Amoy Testnet. Your wallet address will appear once connected.',
    category: 'Getting Started',
    order: 1,
    isActive: true
  },
  {
    question: 'How do I register for the protocol?',
    answer: 'Go to the Activation Center, enter a referrer address (optional), approve 10 USDT, and click "Register". Registration includes Level 1 activation and costs 10 USDT total.',
    category: 'Getting Started',
    order: 2,
    isActive: true
  },
  {
    question: 'Why is my level not activating yet?',
    answer: 'Levels must be activated sequentially. You need to activate Level 1 before Level 2, Level 2 before Level 3, etc. Also ensure you have sufficient USDT balance and allowance approved for the level price.',
    category: 'Levels & Activation',
    order: 1,
    isActive: true
  },
  {
    question: 'What are the level prices?',
    answer: 'Level 1: 10 USDT, Level 2: 20 USDT, Level 3: 40 USDT, Level 4: 80 USDT, Level 5: 160 USDT, Level 6: 320 USDT, Level 7: 640 USDT, Level 8: 1280 USDT, Level 9: 2560 USDT, Level 10: 5120 USDT.',
    category: 'Levels & Activation',
    order: 2,
    isActive: true
  },
  {
    question: 'How do orbits work?',
    answer: 'Each level is associated with an orbit type: P4 (Levels 1,4,7,10), P12 (Levels 2,5,8), P39 (Levels 3,6,9). When you activate a level, you occupy a position in that orbit. As positions fill, payouts are distributed according to smart contract rules.',
    category: 'Orbits System',
    order: 1,
    isActive: true
  },
  {
    question: 'Why does my orbit activity look different?',
    answer: 'Orbit views show the current cycle. You can view historical cycles using the cycle switcher. Positions may appear differently based on whether you are viewing the live orbit or a completed cycle.',
    category: 'Orbits System',
    order: 2,
    isActive: true
  },
  {
    question: 'How do I earn commissions from referrals?',
    answer: 'When someone registers using your referral link, you earn commissions from their level activations. Commission structure is built into the orbit contracts and varies by level.',
    category: 'Referrals & Commissions',
    order: 1,
    isActive: true
  },
  {
    question: 'How do I find my referral link?',
    answer: 'Go to the Community Hub page. Your unique referral link is displayed in the "Your Referral Arsenal" section. Copy and share it with friends.',
    category: 'Referrals & Commissions',
    order: 2,
    isActive: true
  },
  {
    question: 'How do I confirm I am on the correct network?',
    answer: 'Check your wallet network - it should show "Polygon Amoy Testnet". If not, click the network dropdown in your wallet and select/add Polygon Amoy. The chain ID is 0x13882.',
    category: 'Technical Issues',
    order: 1,
    isActive: true
  },
  {
    question: 'My transaction is stuck / pending. What should I do?',
    answer: 'Try increasing gas fees, resetting your wallet nonce, or waiting for network congestion to clear. You can also check the transaction status on Polygonscan using your transaction hash.',
    category: 'Technical Issues',
    order: 2,
    isActive: true
  },
  {
    question: 'What does "insufficient allowance" mean?',
    answer: 'You need to approve USDT spending before activating a level. Click the "Approve" button for the specific level amount, confirm the transaction, then try activating again.',
    category: 'Technical Issues',
    order: 3,
    isActive: true
  },
  {
    question: 'Is my wallet safe on this platform?',
    answer: 'FFN is a non-custodial platform - your funds remain in your wallet. Always verify transaction details before signing. Never share your seed phrase with anyone.',
    category: 'Account & Security',
    order: 1,
    isActive: true
  },
  {
    question: 'What is the ID1 wallet?',
    answer: 'The ID1 wallet is a special wallet that has all levels auto-activated. It serves as the root referrer for users who register without a referrer.',
    category: 'Account & Security',
    order: 2,
    isActive: true
  }
];

async function seedFaqs() {
  try {
    console.log('🌱 Connecting to MongoDB...');
    console.log('URI:', process.env.MONGODB_URI);
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Clear existing FAQs
    const deleteResult = await SupportFaq.deleteMany({});
    console.log(`🗑️  Deleted ${deleteResult.deletedCount} existing FAQs`);
    
    // Insert new FAQs
    const result = await SupportFaq.insertMany(faqs);
    console.log(`✅ Seeded ${result.length} FAQs successfully!`);
    
    // Display seeded categories
    const categories = [...new Set(faqs.map(f => f.category))];
    console.log('\n📚 Categories seeded:');
    categories.forEach(cat => {
      const count = faqs.filter(f => f.category === cat).length;
      console.log(`   - ${cat}: ${count} FAQs`);
    });
    
  } catch (error) {
    console.error('❌ Error seeding FAQs:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

seedFaqs();