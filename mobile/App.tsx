import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, NativeModules, Platform, Pressable, Share, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import nodejs from 'nodejs-mobile-react-native';
import { cloudflareBridge } from './src/cloudflare-bridge';

const CLOUD = 'https://tv-link.izumi.watch';
function openExternal(url: string) {
  try { if (new URL(url).protocol === 'https:') void Linking.openURL(url).catch(() => Alert.alert('Could not open this link')); } catch {}
}
export default function App() {
  const local = useRef<WebView<object>>(null), cloud = useRef<WebView<object>>(null);
  const [url, setUrl] = useState(''), [error, setError] = useState('');
  const [cloudOpen, setCloudOpen] = useState(false), [auth, setAuth] = useState('');
  const readyUrl = useRef('');
  const pending = useRef(new Map<string, 'installer' | 'cloudflare'>());
  useEffect(() => {
    const receive = (raw: string) => {
      let message; try { message = JSON.parse(raw); } catch { return; }
      if (message.type === 'runtime-ready') {
        const addresses = Platform.OS === 'android' ? NativeModules.InstallerNetwork.getAddresses().catch(() => []) : Promise.resolve(undefined);
        void addresses.then((result: string[] | undefined) => nodejs.channel.send(JSON.stringify({ type: 'init', addresses: result })));
      }
      else if (message.type === 'ready') { readyUrl.current = message.url; setUrl(message.url); }
      else if (message.type === 'fatal') setError(message.error);
      else if (message.type === 'samsung-auth') setAuth(message.url);
      else if (message.type === 'event') {
        if (message.event === 'installer:auth-complete') setAuth('');
        local.current?.postMessage(raw);
      } else if (message.type === 'result') {
        const scope = pending.current.get(message.id); pending.current.delete(message.id);
        if (scope === 'cloudflare') cloud.current?.postMessage(raw);
        if (scope === 'installer') local.current?.postMessage(raw);
      }
    };
    nodejs.channel.addListener('message', receive);
    nodejs.start('main.js', { redirectOutputToLogcat: false });
    return () => nodejs.channel.removeListener('message', receive);
  }, []);

  function message(event: WebViewMessageEvent, scope: 'installer' | 'cloudflare') {
    try {
      const source = new URL(event.nativeEvent.url);
      if (scope === 'cloudflare' ? source.origin !== CLOUD : event.nativeEvent.url !== readyUrl.current) return;
      const value = JSON.parse(event.nativeEvent.data);
      if (value.type === 'open-cloudflare' && scope === 'installer') { setCloudOpen(true); return; }
      if ((value.type === 'share-logs' && scope === 'installer') || (value.type === 'share-recovery' && scope === 'cloudflare')) {
        if (typeof value.text === 'string' && value.text.length <= 1024 * 1024) void Share.share({ title: value.type === 'share-logs' ? 'izumi installation logs' : 'izumi TV recovery', message: value.text }).catch(() => Alert.alert('Could not open sharing', 'Please try again.'));
        return;
      }
      if (value.type !== 'request' || value.scope !== scope || typeof value.id !== 'string' || value.id.length > 80 || pending.current.has(value.id)) return;
      const methods = scope === 'installer' ? ['getConfig', 'run', 'verifyCode', 'logs'] : ['accounts', 'preview', 'deploy'];
      if (!methods.includes(value.method) || event.nativeEvent.data.length > 1024 * 1024) return;
      pending.current.set(value.id, scope);
      nodejs.channel.send(event.nativeEvent.data);
    } catch { /* Ignore unrelated WebView messages. */ }
  }
  function closeCloud() {
    if ([...pending.current.values()].includes('cloudflare')) { Alert.alert('Setup is running', 'Keep this screen open until Cloudflare setup finishes.'); return; }
    setCloudOpen(false);
  }
  function cancelSignIn() {
    nodejs.channel.send(JSON.stringify({ type: 'request', scope: 'installer', id: 'cancel-samsung', method: 'cancelAuthorization' }));
    setAuth('');
  }
  const toolbar = (title: string, close: () => void) => <View style={styles.bar}><Text style={styles.title}>{title}</Text><Pressable accessibilityRole="button" onPress={close} style={styles.close}><Text style={styles.closeText}>Close</Text></Pressable></View>;
  return <SafeAreaProvider><SafeAreaView style={styles.root} edges={['top', 'bottom']}><StatusBar barStyle="light-content" />
    {url ? <WebView<object> ref={local} source={{ uri: url }} style={styles.web} originWhitelist={['http://127.0.0.1:*']} onMessage={event => message(event, 'installer')} onShouldStartLoadWithRequest={request => request.url === url} onError={() => setError('The installer interface could not load. Close and reopen the app.')} javaScriptEnabled domStorageEnabled={false} /> : <View style={styles.loading}><ActivityIndicator color="#50e2d5" /><Text style={styles.title}>Starting izumi installer…</Text></View>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <Modal visible={cloudOpen} onRequestClose={closeCloud} animationType="slide"><SafeAreaView style={styles.root}>{toolbar('TV Cloudflare setup', closeCloud)}
      <WebView<object> ref={cloud} source={{ uri: CLOUD }} style={styles.web} originWhitelist={['https://*']} onMessage={event => message(event, 'cloudflare')} injectedJavaScriptBeforeContentLoaded={cloudflareBridge} injectedJavaScript={cloudflareBridge} onOpenWindow={event => openExternal(event.nativeEvent.targetUrl)} onShouldStartLoadWithRequest={request => { if (new URL(request.url).origin === CLOUD) return true; openExternal(request.url); return false; }} javaScriptEnabled domStorageEnabled={false} />
    </SafeAreaView></Modal>
    <Modal visible={Boolean(auth)} onRequestClose={cancelSignIn} animationType="slide"><SafeAreaView style={styles.root}>{toolbar('Samsung sign-in', cancelSignIn)}
      {auth ? <WebView<object> source={{ uri: auth }} originWhitelist={['https://*', 'http://localhost:*', 'http://127.0.0.1:*']} onShouldStartLoadWithRequest={request => { try { const target = new URL(request.url); return target.protocol === 'https:' || (['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '4794'); } catch { return false; } }} javaScriptEnabled sharedCookiesEnabled={Platform.OS === 'ios'} /> : null}
    </SafeAreaView></Modal>
  </SafeAreaView></SafeAreaProvider>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#0c0e10' }, web: { flex: 1, backgroundColor: '#0c0e10' }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }, title: { color: '#eef3f6', fontSize: 16, fontWeight: '600' }, bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, minHeight: 52 }, close: { padding: 12 }, closeText: { color: '#50e2d5', fontWeight: '700' }, error: { color: '#efb68b', padding: 20 } });
