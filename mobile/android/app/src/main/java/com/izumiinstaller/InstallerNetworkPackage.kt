package com.izumiinstaller

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.net.Inet4Address

class InstallerNetworkPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(InstallerNetwork(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

class InstallerNetwork(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "InstallerNetwork"

    @ReactMethod
    fun getAddresses(promise: Promise) {
        try {
            val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val networks = manager.allNetworks.sortedBy { network ->
                val caps = manager.getNetworkCapabilities(network)
                when {
                    network == manager.activeNetwork && caps?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) != true -> 0
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> 1
                    caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> 1
                    else -> 2
                }
            }
            val addresses = networks.flatMap { manager.getLinkProperties(it)?.linkAddresses ?: emptyList() }
                .map { it.address }.filter { it is Inet4Address && !it.isLoopbackAddress && !it.isLinkLocalAddress }
                .mapNotNull { it.hostAddress }.distinct()
            val result = Arguments.createArray()
            addresses.forEach { result.pushString(it) }
            promise.resolve(result)
        } catch (error: Exception) { promise.reject("NETWORK", "Could not read this phone's network addresses.") }
    }
}
