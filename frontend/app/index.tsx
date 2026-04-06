import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  Image,
  Dimensions,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const ROWS_PER_PAGE = 50;

// ─── Types ─────────────────────────────────────────────────────────
interface DetectedFormat {
  bank_name: string;
  columns: string[];
  date_format: string;
  amount_style: string;
  currency_symbol: string;
}

interface Transaction {
  date: string;
  narration: string;
  reference: string;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  balance_mismatch: boolean;
  page_number: number;
}

interface Summary {
  bank_name: string;
  total_transactions: number;
  total_debit: number;
  total_credit: number;
  net_flow: number;
  opening_balance: number | null;
  closing_balance: number | null;
  period_from: string;
  period_to: string;
  total_pages: number;
  mismatched_rows: number;
}

interface ParseConfidence {
  score: number;
  level: 'high' | 'medium' | 'low';
  review_recommended: boolean;
  reasons: string[];
  pages_with_transactions: number;
  skipped_pages: number;
  locally_parsed_pages: number;
  ai_fallback_pages: number;
  token_strategy: string;
}

type Step = 'upload' | 'confirm' | 'processing' | 'results';

// ─── Format Indian Number ──────────────────────────────────────────
function formatINR(num: number | null | undefined): string {
  if (num === null || num === undefined) return '-';
  const isNeg = num < 0;
  const abs = Math.abs(num);
  const parts = abs.toFixed(2).split('.');
  let intPart = parts[0];
  const decPart = parts[1];
  if (intPart.length <= 3) {
    return `${isNeg ? '-' : ''}₹${intPart}.${decPart}`;
  }
  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  let formatted = '';
  while (rest.length > 2) {
    formatted = ',' + rest.slice(-2) + formatted;
    rest = rest.slice(0, -2);
  }
  formatted = rest + formatted + ',' + last3;
  return `${isNeg ? '-' : ''}₹${formatted}.${decPart}`;
}

// ─── Main App ──────────────────────────────────────────────────────
export default function Index() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [error, setError] = useState('');

  // Upload state
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [selectedFileUri, setSelectedFileUri] = useState('');
  const [pdfPassword, setPdfPassword] = useState('');
  const [passwordRequired, setPasswordRequired] = useState(false);

  // Format detection state
  const [detectedFormat, setDetectedFormat] = useState<DetectedFormat | null>(null);
  const [fullText, setFullText] = useState('');
  const [totalPages, setTotalPages] = useState(0);
  const [editBankName, setEditBankName] = useState('');

  // Results state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [confidence, setConfidence] = useState<ParseConfidence | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [activeTab, setActiveTab] = useState<'transactions' | 'summary'>('transactions');

  // ─── Upload ──────────────────────────────────────────────────────
  const pickDocument = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.size && asset.size > 25 * 1024 * 1024) {
          setError('File too large. Maximum size is 25MB.');
          return;
        }
        setSelectedFile(asset.name || 'document.pdf');
        setSelectedFileUri(asset.uri);
        setPdfPassword('');
        setPasswordRequired(false);
        setError('');
        await uploadFile(asset.uri, asset.name || 'document.pdf');
      }
    } catch (e: any) {
      setError('Failed to pick document: ' + e.message);
    }
  }, []);

  const uploadFile = async (uri: string, name: string, password?: string) => {
    setLoading(true);
    setLoadingMsg('Uploading & reading PDF...');
    setError('');
    try {
      let response: Response;

      if (Platform.OS === 'web') {
        // On web, fetch the blob from the URI and create proper FormData
        const fileBlob = await fetch(uri).then(r => r.blob());
        const formData = new FormData();
        formData.append('file', fileBlob, name);
        if (password) {
          formData.append('password', password);
        }
        response = await fetch(`${BACKEND_URL}/api/upload-pdf`, {
          method: 'POST',
          body: formData,
        });
      } else {
        const formData = new FormData();
        const fileObj: any = {
          uri: uri,
          name: name,
          type: 'application/pdf',
        };
        formData.append('file', fileObj);
        if (password) {
          formData.append('password', password);
        }
        response = await fetch(`${BACKEND_URL}/api/upload-pdf`, {
          method: 'POST',
          body: formData,
        });
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Upload failed (${response.status})`);
      }

      const data = await response.json();
      setPasswordRequired(false);
      setDetectedFormat(data.detected_format);
      setEditBankName(data.detected_format.bank_name);
      setFullText(data.full_text);
      setTotalPages(data.total_pages);
      setStep('confirm');
    } catch (e: any) {
      const message = e.message || 'Upload failed. Please try again.';
      if (message.toLowerCase().includes('password-protected') || message.toLowerCase().includes('incorrect pdf password')) {
        setPasswordRequired(true);
      }
      setError(message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  const retryWithPassword = async () => {
    if (!selectedFileUri || !selectedFile) {
      setError('Please select a PDF first.');
      return;
    }
    if (!pdfPassword.trim()) {
      setError('Enter the PDF password to continue.');
      return;
    }
    await uploadFile(selectedFileUri, selectedFile, pdfPassword.trim());
  };

  // ─── Parse Transactions ──────────────────────────────────────────
  const parseTransactions = async () => {
    if (!detectedFormat) return;
    setStep('processing');
    setLoading(true);
    setLoadingMsg('Parsing transactions...');
    setError('');
    try {
      const response = await fetch(`${BACKEND_URL}/api/parse-transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bank_name: editBankName || detectedFormat.bank_name,
          columns: detectedFormat.columns,
          date_format: detectedFormat.date_format,
          amount_style: detectedFormat.amount_style,
          currency_symbol: detectedFormat.currency_symbol,
          full_text: fullText,
          total_pages: totalPages,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || 'Parsing failed');
      }

      const data = await response.json();
      const txns = data.transactions || [];
      const errs = data.errors || [];
      
      setTransactions(txns);
      setSummary(data.summary || null);
      setConfidence(data.confidence || null);
      setParseErrors(errs);
      setCurrentPage(0);

      // Show results even with partial data (some chunks may have failed)
      if (txns.length > 0) {
        // Check for budget errors
        const budgetError = errs.find((e: string) => e.toLowerCase().includes('budget'));
        if (budgetError) {
          setError(`Partial results: ${budgetError}. Showing ${txns.length} transactions extracted before the error.`);
        }
        setStep('results');
      } else if (errs.length > 0) {
        // No transactions and errors - show error
        const budgetError = errs.find((e: string) => e.toLowerCase().includes('budget'));
        if (budgetError) {
          setError(budgetError);
        } else {
          setError('Failed to extract transactions: ' + errs[0]);
        }
        setStep('confirm');
      } else {
        setError('No transactions found in the document.');
        setStep('confirm');
      }
    } catch (e: any) {
      setError(e.message || 'Failed to parse transactions.');
      setStep('confirm');
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // ─── Download Excel ──────────────────────────────────────────────
  const downloadExcel = async () => {
    setLoading(true);
    setLoadingMsg('Generating Excel file...');
    try {
      const response = await fetch(`${BACKEND_URL}/api/download-excel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactions: transactions,
          summary: summary,
        }),
      });

      if (!response.ok) {
        throw new Error('Excel generation failed');
      }

      const blob = await response.blob();

      if (Platform.OS === 'web') {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bank_statement_${summary?.bank_name?.replace(/\s/g, '_') || 'export'}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          const fileUri = FileSystem.cacheDirectory + `bank_statement_${Date.now()}.xlsx`;
          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await Sharing.shareAsync(fileUri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: 'Save Excel File',
          });
        };
        reader.readAsDataURL(blob);
      }
    } catch (e: any) {
      setError('Failed to download Excel: ' + e.message);
    } finally {
      setLoading(false);
      setLoadingMsg('');
    }
  };

  // ─── Reset ───────────────────────────────────────────────────────
  const resetApp = () => {
    setStep('upload');
    setSelectedFile('');
    setSelectedFileUri('');
    setPdfPassword('');
    setPasswordRequired(false);
    setDetectedFormat(null);
    setFullText('');
    setTotalPages(0);
    setEditBankName('');
    setTransactions([]);
    setSummary(null);
    setConfidence(null);
    setParseErrors([]);
    setCurrentPage(0);
    setError('');
    setActiveTab('transactions');
  };

  // ─── Pagination ──────────────────────────────────────────────────
  const totalPageCount = Math.ceil(transactions.length / ROWS_PER_PAGE);
  const paginatedTxns = transactions.slice(
    currentPage * ROWS_PER_PAGE,
    (currentPage + 1) * ROWS_PER_PAGE
  );

  // ─── Render Upload Step ──────────────────────────────────────────
  const renderUpload = () => (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.uploadContent}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.heroSection}>
        <View style={{ width: 140, height: 120, overflow: 'hidden', borderRadius: 16 }}>
          <Image
            source={{ uri: 'https://static.prod-images.emergentagent.com/jobs/d69beafc-693f-4acb-ae99-6911a8a1969c/images/29bbf961c0ec2ee8f91b56569716b2552da857edb72342e62c52f04d70867284.png' }}
            style={{ width: 140, height: 120 }}
            resizeMode="cover"
          />
        </View>
      </View>

      <Text testID="app-title" style={styles.heroTitle}>
        Bank Statement{'\n'}to Excel
      </Text>
      <Text testID="app-subtitle" style={styles.heroSubtitle}>
        Upload any Indian bank statement PDF.{'\n'}Smart parsing converts it to clean Excel.
      </Text>

      <TouchableOpacity
        testID="upload-button"
        style={styles.uploadZone}
        onPress={pickDocument}
        activeOpacity={0.7}
      >
        <Ionicons name="cloud-upload-outline" size={48} color="#5885AF" />
        <Text style={styles.uploadZoneTitle}>Upload PDF</Text>
        <Text style={styles.uploadZoneSubtext}>Tap to pick a bank statement PDF</Text>
        <Text style={styles.uploadZoneLimit}>Max 25MB</Text>
      </TouchableOpacity>

      {passwordRequired && selectedFile ? (
        <View style={styles.passwordCard}>
          <Text style={styles.passwordCardTitle}>Password Required</Text>
          <Text style={styles.passwordCardText}>
            `{selectedFile}` is locked. Enter the PDF password and try again.
          </Text>
          <TextInput
            style={styles.passwordInput}
            value={pdfPassword}
            onChangeText={setPdfPassword}
            placeholder="PDF password"
            placeholderTextColor="#9CA3AF"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity style={styles.primaryButton} onPress={retryWithPassword} activeOpacity={0.8}>
            <Ionicons name="key-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
            <Text style={styles.primaryButtonText}>Unlock PDF</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={styles.featureGrid}>
        <FeatureCard icon="shield-checkmark-outline" title="Privacy First" desc="Processed in memory only" />
        <FeatureCard icon="flash-outline" title="Smart Parsing" desc="Local-first with AI fallback" />
        <FeatureCard icon="checkmark-done-outline" title="Validated" desc="Balance checks included" />
        <FeatureCard icon="color-palette-outline" title="Color Coded" desc="Debits, credits, errors" />
      </View>
    </ScrollView>
  );

  // ─── Render Confirm Step ─────────────────────────────────────────
  const renderConfirm = () => (
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.stepContent}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity testID="back-to-upload" style={styles.backBtn} onPress={resetApp}>
        <Ionicons name="arrow-back" size={22} color="#0B2447" />
        <Text style={styles.backBtnText}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.stepTitle}>Detected Format</Text>
      <Text style={styles.stepSubtitle}>
        Review the detected bank statement format below. Edit if needed.
      </Text>

      {detectedFormat && (
        <View testID="format-card" style={styles.formatCard}>
          <View style={styles.formatRow}>
            <Text style={styles.formatLabel}>Bank Name</Text>
            <TextInput
              testID="edit-bank-name"
              style={styles.formatInput}
              value={editBankName}
              onChangeText={setEditBankName}
              placeholder="Bank name"
              placeholderTextColor="#9CA3AF"
            />
          </View>
          <View style={styles.formatDivider} />

          <View style={styles.formatRow}>
            <Text style={styles.formatLabel}>Columns</Text>
            <Text testID="detected-columns" style={styles.formatValue}>
              {detectedFormat.columns.join(' → ')}
            </Text>
          </View>
          <View style={styles.formatDivider} />

          <View style={styles.formatRow}>
            <Text style={styles.formatLabel}>Date Format</Text>
            <Text testID="detected-date-format" style={styles.formatValue}>
              {detectedFormat.date_format}
            </Text>
          </View>
          <View style={styles.formatDivider} />

          <View style={styles.formatRow}>
            <Text style={styles.formatLabel}>Amount Style</Text>
            <Text testID="detected-amount-style" style={styles.formatValue}>
              {detectedFormat.amount_style === 'combined'
                ? 'Combined (Dr/Cr)'
                : 'Separate Columns'}
            </Text>
          </View>
          <View style={styles.formatDivider} />

          <View style={styles.formatRow}>
            <Text style={styles.formatLabel}>Pages</Text>
            <Text testID="detected-pages" style={styles.formatValue}>
              {totalPages} pages
            </Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        testID="confirm-parse-button"
        style={styles.primaryButton}
        onPress={parseTransactions}
        activeOpacity={0.8}
      >
        <Ionicons name="sparkles" size={20} color="#FFF" style={{ marginRight: 8 }} />
        <Text style={styles.primaryButtonText}>Parse Transactions</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  // ─── Render Processing Step ──────────────────────────────────────
  const renderProcessing = () => (
    <View style={styles.processingContainer}>
      <ActivityIndicator size="large" color="#0B2447" />
      <Text testID="processing-msg" style={styles.processingText}>
        {loadingMsg || 'Processing...'}
      </Text>
      <Text style={styles.processingSubtext}>
        Parsing your {totalPages}-page statement
      </Text>
      <View style={styles.progressBarOuter}>
        <View style={[styles.progressBarInner, { width: '65%' }]} />
      </View>
    </View>
  );

  // ─── Render Results Step ─────────────────────────────────────────
  const renderResults = () => (
    <View style={styles.resultsContainer}>
      {/* Header */}
      <View style={styles.resultsHeader}>
        <TouchableOpacity testID="new-upload-button" style={styles.backBtn} onPress={resetApp}>
          <Ionicons name="add-circle-outline" size={22} color="#0B2447" />
          <Text style={styles.backBtnText}>New Upload</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="download-excel-button"
          style={styles.downloadBtn}
          onPress={downloadExcel}
          activeOpacity={0.8}
        >
          <Ionicons name="download-outline" size={18} color="#FFF" />
          <Text style={styles.downloadBtnText}>Excel</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          testID="tab-transactions"
          style={[styles.tab, activeTab === 'transactions' && styles.activeTab]}
          onPress={() => setActiveTab('transactions')}
        >
          <Text style={[styles.tabText, activeTab === 'transactions' && styles.activeTabText]}>
            Transactions ({transactions.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="tab-summary"
          style={[styles.tab, activeTab === 'summary' && styles.activeTab]}
          onPress={() => setActiveTab('summary')}
        >
          <Text style={[styles.tabText, activeTab === 'summary' && styles.activeTabText]}>
            Summary
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'transactions' ? renderTransactions() : renderSummary()}
    </View>
  );

  // ─── Render Transactions ─────────────────────────────────────────
  const renderTransactions = () => (
    <View style={{ flex: 1 }}>
      {confidence && (
        <View
          style={[
            styles.confidenceBanner,
            confidence.level === 'high'
              ? styles.confidenceHigh
              : confidence.level === 'medium'
              ? styles.confidenceMedium
              : styles.confidenceLow,
          ]}
        >
          <Ionicons
            name={
              confidence.level === 'high'
                ? 'checkmark-circle-outline'
                : confidence.level === 'medium'
                ? 'information-circle-outline'
                : 'alert-circle-outline'
            }
            size={18}
            color={
              confidence.level === 'high'
                ? '#166534'
                : confidence.level === 'medium'
                ? '#92400E'
                : '#991B1B'
            }
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.confidenceBannerTitle}>
              {confidence.level === 'high'
                ? `High confidence (${confidence.score}/100)`
                : confidence.level === 'medium'
                ? `Medium confidence (${confidence.score}/100)`
                : `Review recommended (${confidence.score}/100)`}
            </Text>
            <Text style={styles.confidenceBannerText}>
              {confidence.ai_fallback_pages > 0
                ? `${confidence.locally_parsed_pages} pages parsed locally, ${confidence.ai_fallback_pages} page(s) needed AI fallback.`
                : `Parsed locally with ${confidence.skipped_pages} non-transaction page(s) skipped.`}
            </Text>
          </View>
        </View>
      )}

      {parseErrors.length > 0 && (
        <View testID="parse-errors" style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color="#D97706" />
          <Text style={styles.errorBannerText}>
            {parseErrors.length} parsing warning(s)
          </Text>
        </View>
      )}

      <FlatList
        testID="transactions-list"
        data={paginatedTxns}
        keyExtractor={(_, i) => `txn-${currentPage}-${i}`}
        renderItem={({ item }) => <TransactionRow txn={item} />}
        ListHeaderComponent={
          <View style={styles.tableHeader}>
            <Text style={[styles.thCell, { flex: 0.8 }]}>Date</Text>
            <Text style={[styles.thCell, { flex: 2 }]}>Narration</Text>
            <Text style={[styles.thCell, { flex: 1 }]}>Debit</Text>
            <Text style={[styles.thCell, { flex: 1 }]}>Credit</Text>
            <Text style={[styles.thCell, { flex: 1 }]}>Balance</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="document-text-outline" size={48} color="#9CA3AF" />
            <Text style={styles.emptyText}>No transactions found</Text>
          </View>
        }
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 80 }}
      />

      {/* Pagination */}
      {totalPageCount > 1 && (
        <View testID="pagination" style={styles.pagination}>
          <TouchableOpacity
            testID="prev-page-btn"
            style={[styles.pageBtn, currentPage === 0 && styles.pageBtnDisabled]}
            onPress={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
          >
            <Ionicons name="chevron-back" size={18} color={currentPage === 0 ? '#9CA3AF' : '#0B2447'} />
          </TouchableOpacity>
          <Text testID="page-indicator" style={styles.pageText}>
            {currentPage + 1} / {totalPageCount}
          </Text>
          <TouchableOpacity
            testID="next-page-btn"
            style={[styles.pageBtn, currentPage >= totalPageCount - 1 && styles.pageBtnDisabled]}
            onPress={() => setCurrentPage(p => Math.min(totalPageCount - 1, p + 1))}
            disabled={currentPage >= totalPageCount - 1}
          >
            <Ionicons name="chevron-forward" size={18} color={currentPage >= totalPageCount - 1 ? '#9CA3AF' : '#0B2447'} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // ─── Render Summary ──────────────────────────────────────────────
  const renderSummary = () => {
    if (!summary) return null;
    return (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.summaryContent}
        showsVerticalScrollIndicator={false}
      >
        <View testID="summary-section" style={styles.summaryGrid}>
          <SummaryCard
            testID="summary-bank"
            label="Bank"
            value={summary.bank_name}
            icon="business-outline"
          />
          <SummaryCard
            testID="summary-period"
            label="Period"
            value={`${summary.period_from || '-'}\nto ${summary.period_to || '-'}`}
            icon="calendar-outline"
          />
          <SummaryCard
            testID="summary-total-txns"
            label="Transactions"
            value={String(summary.total_transactions)}
            icon="list-outline"
          />
          <SummaryCard
            testID="summary-pages"
            label="Pages"
            value={String(summary.total_pages)}
            icon="document-outline"
          />
          {confidence && (
            <SummaryCard
              label="Confidence"
              value={`${confidence.level.toUpperCase()} • ${confidence.score}/100`}
              icon="shield-checkmark-outline"
            />
          )}
        </View>

        {confidence && (
          <View style={styles.confidenceCard}>
            <Text style={styles.financialsSectionTitle}>Parse Confidence</Text>
            <FinancialRow label="Confidence Score" value={`${confidence.score}/100`} />
            <FinancialRow
              label="Token Usage"
              value={
                confidence.ai_fallback_pages > 0
                  ? `Low token mode with ${confidence.ai_fallback_pages} AI fallback page(s)`
                  : 'Local only'
              }
            />
            <FinancialRow
              label="Locally Parsed Pages"
              value={String(confidence.locally_parsed_pages)}
            />
            <FinancialRow
              label="Skipped Info Pages"
              value={String(confidence.skipped_pages)}
            />
            {confidence.reasons.map((reason, index) => (
              <Text key={`reason-${index}`} style={styles.confidenceReason}>
                • {reason}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.summaryFinancials}>
          <Text style={styles.financialsSectionTitle}>Financial Summary</Text>
          <FinancialRow label="Opening Balance" value={formatINR(summary.opening_balance)} />
          <FinancialRow label="Total Debits" value={formatINR(summary.total_debit)} color="#DC2626" />
          <FinancialRow label="Total Credits" value={formatINR(summary.total_credit)} color="#059669" />
          <View style={styles.netFlowRow}>
            <Text style={styles.netFlowLabel}>Net Flow</Text>
            <Text
              testID="summary-net-flow"
              style={[
                styles.netFlowValue,
                { color: summary.net_flow >= 0 ? '#059669' : '#DC2626' },
              ]}
            >
              {formatINR(summary.net_flow)}
            </Text>
          </View>
          <FinancialRow label="Closing Balance" value={formatINR(summary.closing_balance)} />
          {summary.mismatched_rows > 0 && (
            <View style={styles.mismatchWarning}>
              <Ionicons name="alert-circle" size={18} color="#D97706" />
              <Text style={styles.mismatchText}>
                {summary.mismatched_rows} balance mismatch(es) found
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  };

  // ─── Main Render ─────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <View style={styles.logoIcon}>
              <Ionicons name="document-text" size={18} color="#FFF" />
            </View>
            <Text testID="app-logo-text" style={styles.topBarTitle}>PDF2Excel</Text>
          </View>
          {step !== 'upload' && step !== 'processing' && (
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>
                {step === 'confirm' ? 'Step 2/3' : 'Complete'}
              </Text>
            </View>
          )}
        </View>

        {/* Error */}
        {error ? (
          <View testID="error-banner" style={styles.globalError}>
            <Ionicons name="alert-circle" size={18} color="#DC2626" />
            <Text style={styles.globalErrorText}>{error}</Text>
            <TouchableOpacity testID="dismiss-error" onPress={() => setError('')}>
              <Ionicons name="close" size={18} color="#DC2626" />
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Loading overlay for upload */}
        {loading && step !== 'processing' ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#0B2447" />
            <Text style={styles.loadingText}>{loadingMsg}</Text>
          </View>
        ) : null}

        {/* Steps */}
        {step === 'upload' && renderUpload()}
        {step === 'confirm' && !loading && renderConfirm()}
        {step === 'processing' && renderProcessing()}
        {step === 'results' && !loading && renderResults()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────
function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <View style={styles.featureCard}>
      <Ionicons name={icon as any} size={22} color="#5885AF" />
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDesc}>{desc}</Text>
    </View>
  );
}

function TransactionRow({ txn }: { txn: Transaction }) {
  const bgColor = txn.balance_mismatch
    ? '#FFFBEB'
    : txn.debit && txn.debit > 0
    ? '#FEF2F2'
    : txn.credit && txn.credit > 0
    ? '#ECFDF5'
    : '#FFFFFF';

  return (
    <View testID="transaction-row" style={[styles.txnRow, { backgroundColor: bgColor }]}>
      <Text style={[styles.txnCell, { flex: 0.8 }]} numberOfLines={1}>
        {txn.date}
      </Text>
      <Text style={[styles.txnCell, { flex: 2, color: '#111827' }]} numberOfLines={2}>
        {txn.narration}
      </Text>
      <Text
        style={[styles.txnCell, { flex: 1, color: txn.debit ? '#DC2626' : '#9CA3AF' }]}
        numberOfLines={1}
      >
        {txn.debit ? formatINR(txn.debit) : '-'}
      </Text>
      <Text
        style={[styles.txnCell, { flex: 1, color: txn.credit ? '#059669' : '#9CA3AF' }]}
        numberOfLines={1}
      >
        {txn.credit ? formatINR(txn.credit) : '-'}
      </Text>
      <Text style={[styles.txnCell, { flex: 1 }]} numberOfLines={1}>
        {txn.balance !== null ? formatINR(txn.balance) : '-'}
      </Text>
    </View>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  testID,
}: {
  label: string;
  value: string;
  icon: string;
  testID?: string;
}) {
  return (
    <View testID={testID} style={styles.summaryCard}>
      <Ionicons name={icon as any} size={24} color="#5885AF" />
      <Text style={styles.summaryCardLabel}>{label}</Text>
      <Text style={styles.summaryCardValue}>{value}</Text>
    </View>
  );
}

function FinancialRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.financialRow}>
      <Text style={styles.financialLabel}>{label}</Text>
      <Text style={[styles.financialValue, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scrollContainer: {
    flex: 1,
  },

  // ─── Top Bar ─────────────────────
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    backgroundColor: '#FFFFFF',
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#0B2447',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0B2447',
    letterSpacing: -0.3,
  },
  stepBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  stepBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },

  // ─── Upload ──────────────────────
  uploadContent: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  heroSection: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  heroImage: {
    width: SCREEN_WIDTH * 0.35,
    height: 120,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0B2447',
    letterSpacing: -0.5,
    lineHeight: 40,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#6B7280',
    lineHeight: 24,
    marginBottom: 32,
  },
  uploadZone: {
    borderStyle: 'dashed' as any,
    borderWidth: 2,
    borderColor: '#5885AF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8F9FA',
    marginBottom: 32,
  },
  uploadZoneTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B2447',
    marginTop: 12,
  },
  uploadZoneSubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  uploadZoneLimit: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 8,
  },
  passwordCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#FED7AA',
    marginBottom: 24,
  },
  passwordCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#9A3412',
    marginBottom: 6,
  },
  passwordCardText: {
    fontSize: 14,
    lineHeight: 22,
    color: '#7C2D12',
    marginBottom: 14,
  },
  passwordInput: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FDBA74',
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 14,
  },

  // ─── Features ────────────────────
  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  featureCard: {
    width: '48%',
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0B2447',
    marginTop: 8,
  },
  featureDesc: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },

  // ─── Confirm Step ────────────────
  stepContent: {
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  backBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0B2447',
    marginLeft: 6,
  },
  stepTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#0B2447',
    marginTop: 16,
    letterSpacing: -0.3,
  },
  stepSubtitle: {
    fontSize: 15,
    color: '#6B7280',
    marginTop: 8,
    marginBottom: 24,
    lineHeight: 22,
  },
  formatCard: {
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 24,
  },
  formatRow: {
    paddingVertical: 10,
  },
  formatLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  formatValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 22,
  },
  formatInput: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  formatDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  primaryButton: {
    flexDirection: 'row',
    backgroundColor: '#0B2447',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  // ─── Processing ──────────────────
  processingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  processingText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0B2447',
    marginTop: 24,
    textAlign: 'center',
  },
  processingSubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
  },
  progressBarOuter: {
    width: '80%',
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    marginTop: 24,
    overflow: 'hidden',
  },
  progressBarInner: {
    height: '100%',
    backgroundColor: '#0B2447',
    borderRadius: 3,
  },

  // ─── Results ─────────────────────
  resultsContainer: {
    flex: 1,
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  downloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B2447',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  downloadBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // ─── Tabs ────────────────────────
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 24,
    marginTop: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#0B2447',
  },

  // ─── Transactions Table ──────────
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#0B2447',
    marginHorizontal: 16,
    marginTop: 16,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  thCell: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  txnRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    alignItems: 'center',
  },
  txnCell: {
    fontSize: 12,
    color: '#6B7280',
  },

  // ─── Pagination ──────────────────
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    gap: 16,
  },
  pageBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageBtnDisabled: {
    opacity: 0.4,
  },
  pageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0B2447',
  },

  // ─── Summary ─────────────────────
  summaryContent: {
    padding: 24,
    paddingBottom: 48,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  summaryCard: {
    width: '48%',
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  summaryCardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryCardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginTop: 4,
  },
  summaryFinancials: {
    backgroundColor: '#F8F9FA',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  confidenceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 16,
  },
  financialsSectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0B2447',
    marginBottom: 16,
  },
  financialRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  financialLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  financialValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  netFlowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  netFlowLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0B2447',
  },
  netFlowValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  mismatchWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 12,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    gap: 8,
  },
  mismatchText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#D97706',
  },
  confidenceReason: {
    fontSize: 13,
    lineHeight: 20,
    color: '#4B5563',
    marginTop: 8,
  },

  // ─── Error ───────────────────────
  confidenceBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  confidenceHigh: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  confidenceMedium: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  confidenceLow: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  confidenceBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  confidenceBannerText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#4B5563',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    padding: 10,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    gap: 6,
  },
  errorBannerText: {
    fontSize: 13,
    color: '#D97706',
    fontWeight: '600',
  },
  globalError: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginTop: 8,
    padding: 12,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    gap: 8,
  },
  globalErrorText: {
    flex: 1,
    fontSize: 13,
    color: '#DC2626',
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 15,
    color: '#9CA3AF',
    marginTop: 12,
  },

  // ─── Loading ─────────────────────
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  loadingText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0B2447',
    marginTop: 16,
  },
});
